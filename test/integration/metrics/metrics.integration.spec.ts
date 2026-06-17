import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
// tech debt -- maybe couples to metrics implementation details
describe('Metrics (/metrics)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes /metrics in Prometheus format, public (no JWT), with Node default metrics', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(res.headers['content-type']).toContain('text/plain');
    // collectDefaultMetrics registers these in the MetricsService constructor.
    expect(res.text).toMatch(/nodejs_|process_/);
  });
});
