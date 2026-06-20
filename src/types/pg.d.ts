// O driver `pg` não embarca tipos e o projeto não instala @types/pg.
// Declaração mínima para o conector de bases do Motor de Vendas (uso read-only).
declare module 'pg';
