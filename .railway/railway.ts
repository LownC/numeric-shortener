import { defineRailway, project, service } from 'railway/iac';

// Offline-checked deployment intent only. No source/account/domain/DB/secrets.
// Do not plan/apply until M4-B is explicitly approved.
export default defineRailway(() => {
  const web = service('numeric-shortener', {
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    deploy: {
      healthcheckPath: '/healthz',
      healthcheckTimeout: 300,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
    },
  });
  return project('numeric-shortener', { resources: [web] });
});
