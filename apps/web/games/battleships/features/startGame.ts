import { DEFAULT_PARTICIPATION_FEE } from 'zknoid-chain-dev/dist/src/engine/LobbyManager';
import { getEnvContext } from '@/lib/envContext';
import { PublicKey, UInt64 } from 'o1js';
import { GameState } from '../lib/gameState';
import { api } from '@/trpc/react';
import { useStore } from 'zustand';
import { useSessionKeyStore } from '@/lib/stores/sessionKeyStorage';
import { useMinaBridge } from '@/lib/stores/protokitBalances';
import { client } from 'zknoid-chain-dev';
import { useNetworkStore } from '@/lib/stores/network';
import { type PendingTransaction } from '@proto-kit/sequencer';

export const useStartGame = (
  competitionID: string,
  setGameState: (state: GameState) => void
) => {
  const gameStartedMutation = api.logging.logGameStarted.useMutation();
  const sessionPublicKey = useStore(useSessionKeyStore, (state) =>
    state.getSessionKey()
  ).toPublicKey();
  const bridge = useMinaBridge();
  const networkStore = useNetworkStore();
  const progress = api.progress.setSolvedQuests.useMutation();

  return async () => {
    // Attempt to fund the game
    if (await bridge(DEFAULT_PARTICIPATION_FEE.toBigInt())) return;

    // Log the game start
    gameStartedMutation.mutate({
      gameId: 'battleships', // Use a unique identifier for the Battleships game
      userAddress: networkStore.address ?? '',
      envContext: getEnvContext(),
    });

    // Resolve the Battleships logic
    const battleshipsLogic = client.runtime.resolve('BattleshipsLogic');

    // Create a transaction to initialize the game
    const tx = await client.transaction(
      PublicKey.fromBase58(networkStore.address!),
      async () => {
        // Call the initGame method of BattleshipsLogic
        battleshipsLogic.initGame(
          { id: competitionID, players: [sessionPublicKey, PublicKey.empty()], participationFee: DEFAULT_PARTICIPATION_FEE },
          true
        );
      }
    );

    // Sign and send the transaction
    await tx.sign();
    await tx.send();

    // Log progress for game registration
    await progress.mutateAsync({
      userAddress: networkStore.address!,
      section: 'BATTLESHIPS',
      id: 0,
      txHash: JSON.stringify((tx.transaction! as PendingTransaction).toJSON()),
      roomId: competitionID,
      envContext: getEnvContext(),
    });

    // Update game state to indicate match registration
    setGameState(GameState.MatchRegistration);
  };
};
