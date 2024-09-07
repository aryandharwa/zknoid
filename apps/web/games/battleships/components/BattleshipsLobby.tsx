import GamePage from '@/components/framework/GamePage';
import { battleshipsConfig } from '@/games/battleships/config';
import RandzuCoverSVG from '@/games/randzu/assets/game-cover.svg';
import RandzuCoverMobileSVG from '@/games/randzu/assets/game-cover-mobile.svg';
import { useContext, useState } from 'react';
import ZkNoidGameContext from '@/lib/contexts/ZkNoidGameContext';
import { ClientAppChain, ProtoUInt64 } from 'zknoid-chain-dev';
import { useNetworkStore } from '@/lib/stores/network';
import LobbyPage from '@/components/framework/Lobby/LobbyPage';

export default function BattleshipsLobby({
  params,
}: {
  params: { lobbyId: string };
}) {
  const networkStore = useNetworkStore();

  const { client } = useContext(ZkNoidGameContext);

  if (!client) {
    throw Error('Context app chain client is not set');
  }

  const client_ = client as ClientAppChain<
    typeof battleshipsConfig.runtimeModules,
    any,
    any,
    any
  >;

  return (
    <GamePage
      gameConfig={battleshipsConfig}
      image={RandzuCoverSVG}
      mobileImage={RandzuCoverMobileSVG}
      defaultPage={'Lobby list'}
    >
      <LobbyPage
        lobbyId={params.lobbyId}
        query={
          networkStore.protokitClientStarted
            ? client_.query.runtime.BattleshipsLogic
            : undefined
        }
        contractName={'BattleshipsLogic'}
        config={battleshipsConfig}
      />
    </GamePage>
  );
}
