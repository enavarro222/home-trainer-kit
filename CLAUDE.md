# home-trainer-kit

Code commun aux jeux de home trainer (`contour`, `sonne_la_cloche`) : ce qui parle au matériel, rien qui
dépende d'un jeu. Sources TypeScript exportées telles quelles (`exports` → `src/index.ts`), sans étape
de build : Vite et Vitest des jeux les lisent directement.

## Contenu

- **Home trainer** (`src/ble/`, `types.ts`, `useSensor.ts`) : Web Bluetooth, FTMS (puissance, cadence,
  pente simulée `0x11` ou niveau de résistance `0x04`), Cycling Power, CSC. Repris de Sonne la Cloche
  (`src/sensors`, à jour de c728146), avec le capteur de démo (pédaler avec ← → en alternance,
  `demo/`). Le modèle de route (Crr, Cw) est un paramètre de `connectTrainer` /
  `useSensor` (`DEFAULT_ROAD` sinon).
- **Vitesses virtuelles** (`gears.ts`), pour un seul pignon (Zwift Cog) : un braquet k fois plus grand
  que le réel demande au home trainer k·F(k·v), soit pente × k, Crr × k, Cw × k³. Table de 24 rapports
  (0,75 à 5,49), départ sur le rapport le plus proche du réel. Avec une cassette, le jeu n'appelle pas
  `setGear` : rien ne change. Home trainers sans simulation : approximation par niveau de résistance.
- **Commandes au guidon** (`controls.ts`) : les sources émettent des actions (`left`, `right`,
  `select`, `gearUp`, `gearDown`, `powerUp`, `powerDown`, et `b`, `y`, `z` : boutons Zwift sans sens
  imposé, au jeu de choisir), les écrans les écoutent avec `useControls`.
  Sources : manette (`gamepad.ts`, `useGamepadControls`, à monter une fois) et télécommandes Zwift
  (`zwiftClick.ts`, `useZwiftController`). Le clavier reste propre à chaque jeu.
- **Zwift Click / Click v2 / Ride** : protocole non officiel, rétro-ingénierie (makinolo.com,
  thomaschampagne/zwiftboard, ajchellew/zwiftplay). « RideOn » écrit puis répété toutes les 3 s ;
  boutons en message `0x23` (bitmap, 0 = appuyé) ou `0x37` (Click v1, à vérifier sur un vrai appareil).
  Une seule connexion à la fois : fermer Zwift / Companion / BikeControl. Pas d'iOS (pas de Web
  Bluetooth). Click v2 : Zwift le verrouille sur son appli, ce qui répond sans « déverrouillage » reste à
  vérifier.

## Application de test

`demo/` (`pnpm dev`, `pnpm build` → `dist/`) : connecter un home trainer (protocole, mode de pilotage,
puissance, cadence, pente à envoyer, vitesses virtuelles), une télécommande Zwift, voir les actions de
la manette. Publiée sur GitHub Pages par `.github/workflows/pages.yml`
(https://enavarro222.github.io/home-trainer-kit/). Interface en français, comme les jeux.

## Utilisation dans un jeu

- En développement : `"home-trainer-kit": "link:../home-trainer-kit"`.
- Pour la CI d'un jeu : dépendance git taguée `github:enavarro222/home-trainer-kit#vX.Y.Z`. Publier une
  version : tag `vX.Y.Z` poussé (dépôt public github.com/enavarro222/home-trainer-kit, clé SSH perso
  via `core.sshCommand`).

## Code

Code et commentaires en anglais, README en anglais. Commandes : `pnpm test`, `pnpm check` (format,
lint, types, tests), CI GitHub Actions (`ci.yml`). pnpm épinglé (`packageManager`) comme Sonne la Cloche.
Commits avec l'identité perso (enavarro222 <enavarro222@gmail.com>).
