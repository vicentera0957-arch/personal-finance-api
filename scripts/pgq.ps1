# =============================================================================
# Lab de performance PostgreSQL - helpers de captura.  Ver docs/perf/README.md
#
# NOTA: este archivo es ASCII puro A PROPOSITO. Windows PowerShell 5.1 lee los
# .ps1 sin BOM usando el codepage ANSI del sistema, no UTF-8; un solo caracter
# no-ASCII (una tilde, un guion largo) rompe el parser con un error que no tiene
# nada que ver con la linea real. No agregues acentos aca.
#
# CARGAR (dot-source, con el punto y el espacio - NO ejecutar):
#     . .\scripts\pgq.ps1
#
# Dos comandos, dos propositos distintos:
#     pg                     psql interactivo. Explorar, tantear queries.
#                            NADA queda guardado. Es la terminal de trabajo.
#     pgq <archivo.sql>      corre el .sql y GUARDA la salida cruda en
#                            docs/perf/salida/<nombre>.txt. Es la evidencia que
#                            se commitea y que performance.md cita.
#
# La regla del plan: "ejercicio sin numero medido no cuenta". `pg` no produce
# numero medido; `pgq` si. Si algo va a terminar en performance.md, pasa por pgq.
# =============================================================================

$script:PgLabService  = 'postgres'
$script:PgLabUser     = 'finance_user'
$script:PgLabDatabase = 'personal_finance_db'

function Get-PgLabRoot {
    # docker compose necesita correr desde la raiz (ahi vive docker-compose.yml)
    # y las rutas de docs/perf/salida son relativas a esa misma raiz. Derivarla de
    # git en vez de asumir el cwd: asi `pgq docs\perf\scripts\setup.sql` funciona igual
    # desde cualquier subcarpeta del repo.
    $root = git rev-parse --show-toplevel
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
        throw 'pgq: no estas dentro de un repositorio git.'
    }
    return $root.Trim()
}

function pgq {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [string]$File
    )

    # Local a la funcion. En PS 5.1, si la preferencia global fuera 'Stop', el
    # 2>&1 de abajo convierte cualquier linea de stderr de psql en un
    # NativeCommandError terminante y perderiamos justo lo que queremos capturar:
    # el mensaje de error.
    $ErrorActionPreference = 'Continue'

    $root = Get-PgLabRoot
    $sql  = Resolve-Path -LiteralPath $File -ErrorAction Stop
    $name = [System.IO.Path]::GetFileNameWithoutExtension($sql.Path)

    $outDir = Join-Path $root 'docs\perf\salida'
    if (-not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    $outFile = Join-Path $outDir "$name.txt"

    $body = Get-Content -LiteralPath $sql.Path -Raw -Encoding UTF8

    # PS 5.1 usa [Console]::OutputEncoding TANTO para codificar lo que manda al
    # stdin de un exe nativo COMO para decodificar lo que vuelve. Por defecto es
    # el codepage OEM (850/437), asi que un .sql con acentos o simbolos llegaria
    # mutilado a psql y la salida volveria con basura. Se fuerza UTF-8 solo
    # alrededor de la llamada y se restaura despues.
    $prevEncoding = [Console]::OutputEncoding

    Push-Location $root
    try {
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

        # -a  (--echo-all) es lo importante: deja cada sentencia escrita JUNTO a
        #     su resultado. Un .txt con solo resultados es inutil dentro de tres
        #     semanas - no se sabe que se midio.
        # -T  sin TTY: obligatorio al mandar el .sql por stdin.
        # -f -  lee el script desde stdin en vez de una ruta dentro del contenedor.
        # 2>&1  los errores de psql van a stderr; sin esto el .txt de una corrida
        #     fallida sale vacio y parece que no paso nada.
        $lines = $body |
            docker compose exec -T $script:PgLabService psql `
                -U $script:PgLabUser -d $script:PgLabDatabase `
                -v ON_ERROR_STOP=1 -a -P pager=off -f - 2>&1 |
            ForEach-Object { $_.ToString() }
    }
    finally {
        [Console]::OutputEncoding = $prevEncoding
        Pop-Location
    }

    # Cabecera con fecha: los numeros de performance.md solo son comparables
    # entre si dentro del mismo dataset. Si re-seedeas (por ejemplo los 200k que
    # pide E17a), esta linea es lo unico que despues permite saber que .txt quedo
    # medido sobre que tabla.
    $header = @(
        "-- $name",
        "-- corrido: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "-- fuente:  $([System.IO.Path]::GetFileName($sql.Path))",
        ''
    )

    # WriteAllLines con UTF8Encoding($false) = sin BOM. Set-Content -Encoding utf8
    # en PS 5.1 mete BOM y ensucia el diff de git en cada corrida.
    [System.IO.File]::WriteAllLines(
        $outFile,
        [string[]]($header + $lines),
        (New-Object System.Text.UTF8Encoding($false))
    )

    $lines | ForEach-Object { Write-Host $_ }
    Write-Host ''
    Write-Host "-> guardado en docs/perf/salida/$name.txt" -ForegroundColor Green
}

function pg {
    $root = Get-PgLabRoot
    Push-Location $root
    try {
        docker compose exec $script:PgLabService psql `
            -U $script:PgLabUser -d $script:PgLabDatabase @args
    }
    finally {
        Pop-Location
    }
}

Write-Host "lab cargado: 'pg' (explorar) / 'pgq <archivo.sql>' (capturar)" -ForegroundColor Cyan
