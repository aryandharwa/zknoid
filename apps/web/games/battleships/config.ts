import { createZkNoidGameConfig } from '@/lib/createConfig';
import { ZkNoidGameType } from '@/lib/platform/game_types';
import { BattleshipsLogic } from 'zknoid-chain-dev';
import { ZkNoidGameFeature, ZkNoidGameGenre } from '@/lib/platform/game_tags';
import { LogoMode } from '@/app/constants/games';
import Battleships from './Battleships';
import BattleshipsLobby from './components/BattleshipsLobby';

export const battleshipsConfig = createZkNoidGameConfig({
  id: 'battleships',
  type: ZkNoidGameType.PVP,
  name: 'Battleships',
  description: 'Battleships',
  image: '/image/games/soon.svg',
  logoMode: LogoMode.CENTER,
  genre: ZkNoidGameGenre.BoardGames,
  features: [ZkNoidGameFeature.Multiplayer],
  isReleased: true,
  releaseDate: new Date(2024, 0, 1),
  popularity: 50,
  author: 'Aryan',
  rules:
    'Battleships is a game where players take turns guessing the location of the opponent\'s ships on a grid. The game is played on a 10x10 grid, with 5 ships of varying lengths (2, 3, 3, 4, and 5). The ships are placed randomly at the start of the game. The player who sinks all of the opponent\'s ships wins.',
  runtimeModules: {
    BattleshipsLogic,
  },
  page: Battleships,
  // lobby: BattleshipsLobby
});
