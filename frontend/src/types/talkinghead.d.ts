/**
 * Déclaration ambiante pour les modules ESM `.mjs` de la bibliothèque
 * TalkingHead (avatar 3D Ready Player Me + lip-sync, MIT © Mika Suominen).
 *
 * Ces fichiers sont livrés en JavaScript pur (aucun typage). On les importe
 * dynamiquement depuis `BudgetAvatarHeadComponent` : TypeScript n'analyse pas
 * les `.mjs` (`allowJs` désactivé), cette déclaration rend donc l'import
 * typé `any` — l'interface réellement utilisée est décrite localement dans le
 * composant.
 */
declare module '*.mjs';
