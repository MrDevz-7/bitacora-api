/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-only-stdlib',
      severity: 'error',
      comment:
        'domain es el núcleo: solo puede importar de domain y de node:crypto. ' +
        'Nada de application, infrastructure, interfaces ni paquetes npm.',
      from: { path: '^src/domain/' },
      to: { pathNot: ['^src/domain/', '^(node:)?crypto$'] },
    },
    {
      name: 'application-no-outer-layers',
      severity: 'error',
      comment:
        'application depende de domain y de sus propios puertos, nunca de infrastructure ni interfaces.',
      from: { path: '^src/application/' },
      to: { path: '^src/(infrastructure|interfaces)/' },
    },
    {
      name: 'infrastructure-no-interfaces',
      severity: 'error',
      comment:
        'infrastructure implementa puertos; no conoce HTTP/WS. El cableado vive en server.ts/worker.ts.',
      from: { path: '^src/infrastructure/' },
      to: { path: '^src/interfaces/' },
    },
    {
      name: 'interfaces-domain-types-only',
      severity: 'error',
      comment:
        'interfaces habla con application. De domain solo puede importar tipos (import type).',
      from: { path: '^src/interfaces/' },
      to: { path: '^src/domain/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Los ciclos entre módulos hacen frágil el orden de carga y el testeo.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Todo import debe resolverse (o falla en runtime).',
      from: { path: '^src/', pathNot: '^src/domain/' },
      to: { couldNotResolve: true },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'El código de src/ corre en producción, donde se instala con --omit=dev.',
      from: { path: '^src/' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
