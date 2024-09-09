import React, { useContext, useEffect, useState } from 'react';
import { Int64, PublicKey, UInt32, UInt64 } from 'o1js';
import { useStore } from 'zustand';
import { useSessionKeyStore } from '@/lib/stores/sessionKeyStorage';
import GamePage from '@/components/framework/GamePage';
import { battleshipsConfig } from './config';
import BattleshipsCoverSVG from './assets/game-cover.svg';
import BattleshipsCoverMobileSVG from './assets/game-cover-mobile.svg';
import { useNetworkStore } from '@/lib/stores/network';
import { useProtokitChainStore } from '@/lib/stores/protokitChain';
import { motion } from 'framer-motion';
import { GameState } from './lib/GameState';
import { formatPubkey } from '@/lib/utils';
import { api } from '@/trpc/react';
import { getEnvContext } from '@/lib/envContext';
import ZkNoidGameContext from '@/lib/contexts/ZkNoidGameContext';
import { useBattleshipsMatchQueueStore } from '@/games/battleships/stores/matchQueue';
import { ClientAppChain, PENDING_BLOCKS_NUM_CONST, BattleshipsField, BattleshipsWinWitness } from 'zknoid-chain-dev';
import { useLobbiesStore } from '@/lib/stores/lobbiesStore';
import GameWidget from '@/components/framework/GameWidget';
import { DEFAULT_PARTICIPATION_FEE } from 'zknoid-chain-dev/dist/src/engine/LobbyManager';
import { GameWrap } from '@/components/framework/GamePage/GameWrap';
import Button from '@/components/shared/Button';
import { formatUnits } from '@/lib/utils';
import { walletInstalled } from '@/lib/helpers';
import { Currency } from '@/constants/currency';
import { useRateGameStore } from '@/lib/stores/rateGameStore';
import { useStartGame } from '@/games/battleships/features/startGame';
import znakesImg from '@/public/image/tokens/znakes.svg';
import { GameView } from '@/games/battleships/components/GameView';

const competition = {
  id: 'global',
  name: 'Global competition',
  enteringPrice: BigInt(Number(DEFAULT_PARTICIPATION_FEE.toString())),
  prizeFund: BigInt(0),
};

export default function Battleships() {
  const [gameState, setGameState] = useState(GameState.NotStarted);
  const [isHorizontal, setIsHorizontal] = useState(true);
  const [shipPositions, setShipPositions] = useState({});
  const [occupiedCells, setOccupiedCells] = useState(new Set());
  const [allShipsPlaced, setAllShipsPlaced] = useState(false);
  const [draggedShip, setDraggedShip] = useState(null);
  const [draggedShipLength, setDraggedShipLength] = useState(0);

  const { client } = useContext(ZkNoidGameContext);
  const networkStore = useNetworkStore();
  const matchQueue = useBattleshipsMatchQueueStore();
  const rateGameStore = useRateGameStore();
  const protokitChain = useProtokitChainStore();
  const startGame = useStartGame(competition.id, setGameState);
  const sessionPrivateKey = useStore(useSessionKeyStore, (state) => state.getSessionKey());
  const progress = api.progress.setSolvedQuests.useMutation();

  const handleDragStart = (e) => {
    const ship = e.target;
    setDraggedShip(ship);
    setDraggedShipLength(ship.children.length);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const cellIndex = parseInt(e.target.dataset.index, 10);

    if (!draggedShip) return;

    const shipName = draggedShip.classList[1].split("-")[0];
    const newPositions = { ...shipPositions };
    const shipCoordinates = [];
    const newOccupiedCells = new Set(occupiedCells);

    let canPlaceShip = true;

    for (let i = 0; i < draggedShipLength; i++) {
      let row, col;
      if (isHorizontal) {
        row = Math.floor(cellIndex / 10);
        col = (cellIndex % 10) + i;
      } else {
        row = Math.floor(cellIndex / 10) + i;
        col = cellIndex % 10;
      }

      if (row >= 0 && row < 10 && col >= 0 && col < 10) {
        const cellKey = `${row}-${col}`;
        if (newOccupiedCells.has(cellKey)) {
          canPlaceShip = false;
          break;
        }
        shipCoordinates.push([row, col]);
      } else {
        canPlaceShip = false;
        break;
      }
    }

    if (!canPlaceShip) {
      console.log("Cannot place ship here: Overlap or out of bounds detected.");
      return;
    }

    shipCoordinates.forEach(([row, col]) => {
      newOccupiedCells.add(`${row}-${col}`);
    });

    newPositions[shipName] = shipCoordinates;
    setShipPositions(newPositions);
    setOccupiedCells(newOccupiedCells);

    if (Object.keys(newPositions).length === 5) {
      setAllShipsPlaced(true);
    }

    draggedShip.style.display = "none";
    setDraggedShip(null);
  };

  const handleRotate = () => {
    setIsHorizontal((prev) => !prev);
  };

  const handleStartGame = async () => {
    if (!allShipsPlaced) {
      alert("Please place all ships!");
      return;
    }
    console.log("Ship Positions: ", shipPositions);
    await startGame();
    setGameState(GameState.Matchmaking);
  };

  const onCellClicked = async (x, y) => {
    if (!matchQueue.gameInfo?.isCurrentUserMove) return;
    if (matchQueue.gameInfo.field.value[y][x] !== 0) return;

    const currentUserId = matchQueue.gameInfo.currentUserIndex + 1;
    const updatedField = matchQueue.gameInfo.field.value.map(row =>
      row.map(cell => cell.toBigInt())
    );
    updatedField[y][x] = matchQueue.gameInfo.currentUserIndex + 1;

    const battleshipsLogic = client.runtime.resolve('BattleshipsLogic');
    const updatedBattleshipsField = BattleshipsField.from(updatedField);
    const winWitness1 = updatedBattleshipsField.checkWin(currentUserId);

    const tx = await client.transaction(
      sessionPrivateKey.toPublicKey(),
      async () => {
        battleshipsLogic.makeMove(
          UInt64.from(matchQueue.gameInfo.gameId),
          updatedBattleshipsField,
          winWitness1 ||
          new BattleshipsWinWitness({
            x: UInt32.from(0),
            y: UInt32.from(0),
            directionX: Int64.from(0),
            directionY: Int64.from(0),
          })
        );
      }
    );

    tx.transaction = tx.transaction?.sign(sessionPrivateKey);
    await tx.send();

    if (winWitness1) {
      await progress.mutateAsync({
        userAddress: networkStore.address,
        section: 'BATTLESHIPS',
        id: 2,
        txHash: JSON.stringify(tx.transaction.toJSON()),
        roomId: competition.id,
        envContext: getEnvContext(),
      });
      setGameState(GameState.Won);
    } else {
      setGameState(GameState.OpponentTurn);
    }
  };

  const restart = () => {
    matchQueue.resetLastGameState();
    setGameState(GameState.NotStarted);
    setShipPositions({});
    setOccupiedCells(new Set());
    setAllShipsPlaced(false);
  };

  return (
    <GamePage
      gameConfig={battleshipsConfig}
      image={BattleshipsCoverSVG}
      mobileImage={BattleshipsCoverMobileSVG}
      defaultPage={'Game'}
    >
      <motion.div className={'flex grid-cols-4 flex-col-reverse gap-4 pt-10 lg:grid lg:pt-0'} animate={'windowed'}>
        <GameWidget author={battleshipsConfig.author} isPvp playersCount={matchQueue.getQueueLength()} gameId="battleships">
          {gameState === GameState.NotStarted && (
            <div className="ship-placement-container">
              <div className="board-grid-container">
                <GameView
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  occupiedCells={occupiedCells}
                  shipPositions={shipPositions}
                />
              </div>
              <div className="setup-buttons">
                <Button label="Start Game" onClick={handleStartGame} disabled={!allShipsPlaced} />
                <Button label="Rotate Ships" onClick={handleRotate} />
              </div>
              <div className="ships-container">
                {/* Add your ship elements here for dragging */}
              </div>
            </div>
          )}
          {(gameState === GameState.Matchmaking || gameState === GameState.MatchRegistration) && (
            <div>Waiting for opponent...</div>
          )}
          {(gameState === GameState.CurrentPlayerTurn || gameState === GameState.OpponentTurn) && (
            <div style={{ display: 'flex' }}>
              <div style={{ marginRight: '20px' }}>
                <h2>Your Board</h2>
                <GameView shipPositions={shipPositions} />
              </div>
              <div>
                <h2>Opponent's Board</h2>
                <GameView isOpponent onCellClicked={onCellClicked} />
              </div>
            </div>
          )}
          {gameState === GameState.Won && <div>Congratulations! You won!</div>}
          {gameState === GameState.Lost && <div>Sorry, you lost. Better luck next time!</div>}
        </GameWidget>

        {/* Game status and controls */}
        <div className={'flex flex-col lg:hidden'}>
          <Button
            label={gameState === GameState.CurrentPlayerTurn ? 'YOUR TURN' : "OPPONENT'S TURN"}
            isReadonly
          />
          <div className={'flex flex-row gap-4 font-plexsans text-[14px]/[14px] text-left-accent lg:hidden lg:text-[20px]/[20px]'}>
            <span className={'uppercase'}>Players in queue: {matchQueue.getQueueLength()}</span>
          </div>
        </div>

        {/* Game info */}
        <div className={'flex h-full w-full flex-col gap-4 lg:hidden'}>
          <span className={'w-full text-headline-2 font-bold'}>Game</span>
          <div className={'flex w-full gap-2 font-plexsans text-[16px]/[16px] uppercase text-left-accent lg:text-[20px]/[20px]'}>
            <span>Game status: {gameState}</span>
          </div>
          <div className={'flex w-full items-center gap-2 font-plexsans text-[14px]/[14px] text-foreground lg:text-[20px]/[20px]'}>
            <span>Your opponent: {formatPubkey(matchQueue.gameInfo?.opponent)}</span>
          </div>
        </div>
      </motion.div>
    </GamePage>
  );
}