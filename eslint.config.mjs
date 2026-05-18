import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // 1. Archivos a ignorar (reemplaza a .eslintignore)
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'test/**', // Si no quieres linting en los tests e2e todavía
      '.eslintrc.js', // Archivos de config viejos
      'eslint.config.mjs', // Evita que se analice a sí mismo
    ],
  },

  // 2. Configuración base de ESLint y TypeScript
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      // --- REGLAS ESTRICTAS DE TYPESCRIPT ---
      '@typescript-eslint/no-explicit-any': 'error', // Prohibido el uso de 'any'
      '@typescript-eslint/explicit-function-return-type': 'warn', // Obliga a tipar retornos
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // --- REGLAS DE NESTJS / CALIDAD ---
      'no-console': 'warn',

      // --- INTEGRACIÓN CON PRETTIER ---
      'prettier/prettier': 'error', // Marca fallos de formato como errores de ESLint
    },
  },

  // 3. Desactiva reglas de ESLint que choquen con Prettier (Siempre al final)
  eslintConfigPrettier,
);
