'use client'

import { useContext, useEffect, useState } from 'react';
import { Int64, PublicKey, UInt32, UInt64 } from 'o1js';
import { useStore } from 'zustand';
import { useSessionKeyStore } from '@/lib/stores/sessionKeyStorage';
import GamePage from '@/components/framework/GamePage';
import { battleshipsConfig } from './config';
import BattleshipsCoverSVG from './assets/game-cover.svg';
import BattleshipsCoverMobileSVG from './assets/game-cover-mobile.svg';
import { useNetworkStore } from '@/lib/stores/network';
import { useProtokitChainStore } from '@/lib/stores/protokitChain';
import Image from "next/image"
import { motion } from 'framer-motion';
import { GameState } from './lib/GameState';
import { formatPubkey } from '@/lib/utils';
import { api } from '@/trpc/react';
import { getEnvContext } from '@/lib/envContext';
import ZkNoidGameContext from '@/lib/contexts/ZkNoidGameContext';
import {
  useBattleshipsMatchQueueStore
} from '@/games/battleships/stores/matchQueue';
import {
  ClientAppChain,
  PENDING_BLOCKS_NUM_CONST,
  BattleshipsField,
  BattleshipsWinWitness,
} from 'zknoid-chain-dev';
import {
  useLobbiesStore,
  useObserveLobbiesStore,
} from '@/lib/stores/lobbiesStore';
import { MainButtonState } from '@/components/framework/GamePage/PvPGameView';
import GameWidget from '@/components/framework/GameWidget';
import { DEFAULT_PARTICIPATION_FEE } from 'zknoid-chain-dev/dist/src/engine/LobbyManager';
import { GameWrap } from '@/components/framework/GamePage/GameWrap';
import { RateGame } from '@/components/framework/GameWidget/ui/popups/RateGame';
import { Win } from '@/components/framework/GameWidget/ui/popups/Win';
import { Lost } from '@/components/framework/GameWidget/ui/popups/Lost';
import { Competition } from '@/components/framework/GameWidget/ui/Competition';
import { ConnectWallet } from '@/components/framework/GameWidget/ui/popups/ConnectWallet';
import { InstallWallet } from '@/components/framework/GameWidget/ui/popups/InstallWallet';
import Button from '@/components/shared/Button';
import { formatUnits } from '@/lib/unit';
import { walletInstalled } from '@/lib/helpers';
import { Currency } from '@/constants/currency';
import { UnsetCompetitionPopup } from '@/components/framework/GameWidget/ui/popups/UnsetCompetitionPopup';
import { useRateGameStore } from '@/lib/stores/rateGameStore';
import { useStartGame } from '@/games/battleships/features/startGame';
import znakesImg from '@/public/image/tokens/znakes.svg';

const competition = {
  id: 'global',
  name: 'Global competition',
  enteringPrice: BigInt(Number(DEFAULT_PARTICIPATION_FEE.toString())),
  prizeFund: BigInt(0),
};

export default function Battleships() {

  const [gameState, setGameState] = useState(GameState.NotStarted);
  const [isRateGame, setIsRateGame] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingElement, setLoadingElement] = useState({ x: 0, y: 0 });

  const { client } = useContext(ZkNoidGameContext);

  const networkStore = useNetworkStore();
  const matchQueue = useBattleshipsMatchQueueStore();
  const rateGameStore = useRateGameStore();
  const protokitChain = useProtokitChainStore();
  const startGame = useStartGame(competition.id, setGameState);
  const sessionPrivateKey = useStore(useSessionKeyStore, (state) =>
    state.getSessionKey()
  );
  const progress = api.progress.setSolvedQuests.useMutation();
  const getRatingQuery = api.ratings.getGameRating.useQuery({
    gameId: 'battleships',
  });

  const proveOpponentTimeout = async () => {
    const battleshipsLogic = client.runtime.resolve('BattleshipsLogic');

    const tx = await client.transaction(
      PublicKey.fromBase58(networkStore.address),
      async () => {
        battleshipsLogic.proveOpponentTimeout(
          UInt64.from(matchQueue.gameInfo.gameId)
        );
      }
    );

    await tx.sign();
    await tx.send();
  };


  const onCellClicked = async (x, y) => {
    if (!matchQueue.gameInfo?.isCurrentUserMove) return;
    if (matchQueue.gameInfo.field.value[y][x] !== 0) return;
    console.log('After checks');

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

    setLoading(true);
    setLoadingElement({ x, y });

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
    }
  };

  const lobbiesStore = useLobbiesStore();


  const restart = () => {
    matchQueue.resetLastGameState();
    setGameState(GameState.NotStarted);
  };

  const mainButtonState = loading
    ? MainButtonState.TransactionExecution
    : {
      [GameState.CurrentPlayerTurn]: MainButtonState.YourTurn,
      [GameState.OpponentTurn]: MainButtonState.OpponentsTurn,
      [GameState.OpponentTimeout]: MainButtonState.OpponentTimeOut,
      [GameState.NotStarted]: MainButtonState.NotStarted,
      [GameState.WalletNotInstalled]: MainButtonState.WalletNotInstalled,
      [GameState.WalletNotConnected]: MainButtonState.WalletNotConnected,
    }[gameState] || MainButtonState.None;


  // Define the statuses as a JavaScript object
  const statuses = {
    [GameState.WalletNotInstalled]: 'WALLET NOT INSTALLED',
    [GameState.WalletNotConnected]: 'WALLET NOT CONNECTED',
    [GameState.NotStarted]: 'NOT STARTED',
    [GameState.MatchRegistration]: 'MATCH REGISTRATION',
    [GameState.Matchmaking]: `MATCHMAKING ${(protokitChain.block?.height ?? 0) % PENDING_BLOCKS_NUM_CONST
      }  / ${PENDING_BLOCKS_NUM_CONST} 🔍`,
    [GameState.CurrentPlayerTurn]: 'YOUR TURN',
    [GameState.OpponentTurn]: 'OPPONENT TURN',
    [GameState.OpponentTimeout]: `OPPONENT TIMEOUT ${Number(protokitChain?.block?.height) -
      Number(matchQueue.gameInfo?.lastMoveBlockHeight)
      }`,
    [GameState.Won]: 'YOU WON',
    [GameState.Lost]: 'YOU LOST',
  };

  return (
    <GamePage
      gameConfig={battleshipsConfig}
      image={BattleshipsCoverSVG}
      mobileImage={BattleshipsCoverMobileSVG}
      defaultPage={'Game'}
    >
      <motion.div
        className={
          'flex grid-cols-4 flex-col-reverse gap-4 pt-10 lg:grid lg:pt-0'
        }
        animate={'windowed'}
      >

        {/* ============= Game Rules ============= */}
        <div className={'flex flex-col gap-4 lg:hidden'}>
          <span className={'w-full text-headline-2 font-bold'}>Rules</span>
          <span className={'font-plexsans text-buttons-menu font-normal'}>
            {battleshipsConfig.rules}
          </span>
        </div>


        {/* ============= Game Status ============= */}
        <div className={'hidden h-full w-full flex-col gap-4 lg:flex'}>

          {/* Game Status */}
          <div
            className={
              'flex w-full gap-2 font-plexsans text-[20px]/[20px] uppercase text-left-accent'
            }
          >
            <span>Game status:</span>
            <span>{statuses[gameState]}</span>
          </div>

          {/* Your Opponent */}
          <div
            className={
              'flex w-full gap-2 font-plexsans text-[20px]/[20px] text-foreground'
            }
          >
            <span>Your opponent:</span>
            <span>{formatPubkey(matchQueue.gameInfo?.opponent)}</span>
          </div>


          {/* Your Turn */}
          {mainButtonState == MainButtonState.YourTurn && (
            <Button
              startContent={
                <svg
                  width="26"
                  height="18"
                  viewBox="0 0 26 18"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M1 7L10 16L25 1" stroke="#252525" strokeWidth="2" />
                </svg>
              }
              label={'YOUR TURN'}
              isReadonly
            />
          )}


          {/* Opponent's Turn */}
          {mainButtonState == MainButtonState.OpponentsTurn && (
            <Button
              startContent={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M12.5134 10.5851L1.476 0L0.00136988 1.41421L11.0387 11.9994L0 22.5858L1.47463 24L12.5134 13.4136L22.5242 23.0143L23.9989 21.6001L13.988 11.9994L23.9975 2.39996L22.5229 0.98575L12.5134 10.5851Z"
                    fill="#252525"
                  />
                </svg>
              }
              label={"OPPONENT'S TURN"}
              isReadonly
            />
          )}


          {/* Opponent Timed Out */}
          {mainButtonState == MainButtonState.OpponentTimeOut && (
            <Button label={'OPPONENT TIMED OUT'} isReadonly />
          )}


          {/* Transaction Execution */}
          {mainButtonState == MainButtonState.TransactionExecution && (
            <Button
              startContent={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M24 12C24 15.1826 22.7357 18.2348 20.4853 20.4853C18.2348 22.7357 15.1826 24 12 24C8.8174 24 5.76515 22.7357 3.51472 20.4853C1.26428 18.2348 0 15.1826 0 12C0 11.633 0.017 11.269 0.049 10.91L2.041 11.091C2.01367 11.3903 2 11.6933 2 12C2 13.9778 2.58649 15.9112 3.6853 17.5557C4.78412 19.2002 6.3459 20.4819 8.17317 21.2388C10.0004 21.9957 12.0111 22.1937 13.9509 21.8079C15.8907 21.422 17.6725 20.4696 19.0711 19.0711C20.4696 17.6725 21.422 15.8907 21.8079 13.9509C22.1937 12.0111 21.9957 10.0004 21.2388 8.17317C20.4819 6.3459 19.2002 4.78412 17.5557 3.6853C15.9112 2.58649 13.9778 2 12 2C11.6933 2 11.3903 2.01367 11.091 2.041L10.91 0.049C11.269 0.017 11.633 0 12 0C15.1815 0.00344108 18.2318 1.26883 20.4815 3.51852C22.7312 5.76821 23.9966 8.81846 24 12ZM5.663 4.263L4.395 2.717C3.78121 3.2216 3.2185 3.78531 2.715 4.4L4.262 5.665C4.68212 5.15305 5.15135 4.68348 5.663 4.263ZM9.142 2.415L8.571 0.5C7.80965 0.726352 7.0727 1.02783 6.371 1.4L7.31 3.166C7.89418 2.85539 8.50789 2.60381 9.142 2.415ZM3.164 7.315L1.4 6.375C1.02801 7.07678 0.726533 7.81372 0.5 8.575L2.417 9.146C2.60454 8.51172 2.85478 7.89769 3.164 7.313V7.315ZM11 6V10.277C10.7004 10.4513 10.4513 10.7004 10.277 11H7V13H10.277C10.4297 13.2652 10.6414 13.4917 10.8958 13.662C11.1501 13.8323 11.4402 13.9417 11.7436 13.9818C12.047 14.0219 12.3556 13.9917 12.6454 13.8934C12.9353 13.7951 13.1986 13.6314 13.415 13.415C13.6314 13.1986 13.7951 12.9353 13.8934 12.6454C13.9917 12.3556 14.0219 12.047 13.9818 11.7436C13.9417 11.4402 13.8323 11.1501 13.662 10.8958C13.4917 10.6414 13.2652 10.4297 13 10.277V6H11Z"
                    fill="#252525"
                  />
                </svg>
              }
              label={'TRANSACTION EXECUTION'}
              isReadonly
            />
          )}
        </div>


        {/* ============= Main Game Logic ============= */}
        <GameWidget
          author={battleshipsConfig.author}
          isPvp
          playersCount={matchQueue.getQueueLength()}
          gameId="battleships"
        >

          {networkStore.address ? (
            <>
              {!competition ? (
                <GameWrap>
                  <UnsetCompetitionPopup gameId={battleshipsConfig.id} />
                </GameWrap>
              ) : (
                <>
                  {gameState == GameState.Won &&
                    (isRateGame &&
                      !rateGameStore.ratedGamesIds.includes(battleshipsConfig.id) ? (
                      <GameWrap>
                        <RateGame
                          gameId={battleshipsConfig.id}
                          onClick={() => setIsRateGame(false)}
                        />
                      </GameWrap>
                    ) : (
                      <GameWrap>
                        <Win
                          onBtnClick={restart}
                          title={'You won! Congratulations!'}
                          btnText={'Find new game'}
                        />
                      </GameWrap>
                    ))}
                  {gameState == GameState.Lost && (
                    <GameWrap>
                      <Lost startGame={restart} />
                    </GameWrap>
                  )}
                  {gameState === GameState.NotStarted && (
                    <GameWrap>
                      <Button
                        label={`START FOR ${formatUnits(
                          competition.enteringPrice
                        )}`}
                        onClick={startGame}
                        className={'max-w-[40%]'}
                        endContent={
                          <Image
                            src={znakesImg}
                            alt={'Znakes token'}
                            className={'h-[24px] w-[24px] pb-0.5'}
                          />
                        }
                      />
                    </GameWrap>
                  )}
                  {gameState === GameState.OpponentTimeout && (
                    <GameWrap>
                      <div
                        className={
                          'flex max-w-[60%] flex-col items-center justify-center gap-6'
                        }
                      >
                        <svg
                          width="161"
                          height="161"
                          viewBox="0 0 161 161"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M80.442 160.884C124.869 160.884 160.884 124.869 160.884 80.442C160.884 36.0151 124.869 0 80.442 0C36.0151 0 0 36.0151 0 80.442C0 124.869 36.0151 160.884 80.442 160.884Z"
                            fill="#212121"
                          />
                          <path
                            d="M80.442 149.22C118.427 149.22 149.22 118.427 149.22 80.442C149.22 42.457 118.427 11.6641 80.442 11.6641C42.457 11.6641 11.6641 42.457 11.6641 80.442C11.6641 118.427 42.457 149.22 80.442 149.22Z"
                            stroke="#D2FF00"
                            strokeWidth="8"
                            strokeMiterlimit="10"
                          />
                          <path
                            d="M52.8568 92.7354C56.0407 92.7354 58.6218 82.6978 58.6218 70.3157C58.6218 57.9337 56.0407 47.8961 52.8568 47.8961C49.6729 47.8961 47.0918 57.9337 47.0918 70.3157C47.0918 82.6978 49.6729 92.7354 52.8568 92.7354Z"
                            fill="#D2FF00"
                          />
                          <path
                            d="M103.461 92.7354C106.645 92.7354 109.226 82.6978 109.226 70.3157C109.226 57.9337 106.645 47.8961 103.461 47.8961C100.277 47.8961 97.6963 57.9337 97.6963 70.3157C97.6963 82.6978 100.277 92.7354 103.461 92.7354Z"
                            fill="#D2FF00"
                          />
                          <path
                            d="M135.489 76.4906H118.194V82.7178H135.489V76.4906Z"
                            fill="#D2FF00"
                          />
                          <path
                            d="M38.7647 76.4906H21.4697V82.7178H38.7647V76.4906Z"
                            fill="#D2FF00"
                          />
                          <path
                            d="M50.5391 116.29C54.8955 113.646 65.1452 108.224 79.293 108.034C93.6805 107.841 104.212 113.164 108.616 115.72"
                            stroke="#D2FF00"
                            strokeWidth="5"
                            strokeMiterlimit="10"
                          />
                        </svg>

                        <span>Opponent timeout</span>
                        <Button
                          label={'Prove Opponent timeout'}
                          onClick={() =>
                            proveOpponentTimeout()
                              .then(restart)
                              .catch((error) => {
                                console.log(error);
                              })
                          }
                          className={'px-4'}
                        />
                      </div>
                    </GameWrap>
                  )}
                </>
              )}
            </>
          ) : walletInstalled() ? (
            <GameWrap>
              <ConnectWallet
                connectWallet={() => networkStore.connectWallet(false)}
              />
            </GameWrap>
          ) : (
            <GameWrap>
              <InstallWallet />
            </GameWrap>
          )}

          {(gameState === GameState.Matchmaking ||
            gameState === GameState.MatchRegistration ||
            gameState === GameState.CurrentPlayerTurn ||
            gameState === GameState.OpponentTurn) && (
              <GameView
                gameInfo={matchQueue.gameInfo}
                onCellClicked={onCellClicked}
                loadingElement={loadingElement}
                loading={loading}
              />
            )}

        </GameWidget>


        {/* ============= Main button status ============= */}
        <div className={'flex flex-col lg:hidden'}>

          {mainButtonState == MainButtonState.YourTurn && (
            <Button
              startContent={
                <svg
                  width="26"
                  height="18"
                  viewBox="0 0 26 18"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M1 7L10 16L25 1" stroke="#252525" strokeWidth="2" />
                </svg>
              }
              className="uppercase"
              label={'YOUR TURN'}
              isReadonly
            />
          )}


          {mainButtonState == MainButtonState.OpponentsTurn && (
            <Button
              startContent={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M12.5134 10.5851L1.476 0L0.00136988 1.41421L11.0387 11.9994L0 22.5858L1.47463 24L12.5134 13.4136L22.5242 23.0143L23.9989 21.6001L13.988 11.9994L23.9975 2.39996L22.5229 0.98575L12.5134 10.5851Z"
                    fill="#252525"
                  />
                </svg>
              }
              className="uppercase"
              label={"OPPONENT'S TURN"}
              isReadonly
            />
          )}
          {mainButtonState == MainButtonState.OpponentTimeOut && (
            <Button
              className="uppercase"
              label={'OPPONENT TIMED OUT'}
              isReadonly
            />
          )}
          {mainButtonState == MainButtonState.TransactionExecution && (
            <Button
              startContent={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M24 12C24 15.1826 22.7357 18.2348 20.4853 20.4853C18.2348 22.7357 15.1826 24 12 24C8.8174 24 5.76515 22.7357 3.51472 20.4853C1.26428 18.2348 0 15.1826 0 12C0 11.633 0.017 11.269 0.049 10.91L2.041 11.091C2.01367 11.3903 2 11.6933 2 12C2 13.9778 2.58649 15.9112 3.6853 17.5557C4.78412 19.2002 6.3459 20.4819 8.17317 21.2388C10.0004 21.9957 12.0111 22.1937 13.9509 21.8079C15.8907 21.422 17.6725 20.4696 19.0711 19.0711C20.4696 17.6725 21.422 15.8907 21.8079 13.9509C22.1937 12.0111 21.9957 10.0004 21.2388 8.17317C20.4819 6.3459 19.2002 4.78412 17.5557 3.6853C15.9112 2.58649 13.9778 2 12 2C11.6933 2 11.3903 2.01367 11.091 2.041L10.91 0.049C11.269 0.017 11.633 0 12 0C15.1815 0.00344108 18.2318 1.26883 20.4815 3.51852C22.7312 5.76821 23.9966 8.81846 24 12ZM5.663 4.263L4.395 2.717C3.78121 3.2216 3.2185 3.78531 2.715 4.4L4.262 5.665C4.68212 5.15305 5.15135 4.68348 5.663 4.263ZM9.142 2.415L8.571 0.5C7.80965 0.726352 7.0727 1.02783 6.371 1.4L7.31 3.166C7.89418 2.85539 8.50789 2.60381 9.142 2.415ZM3.164 7.315L1.4 6.375C1.02801 7.07678 0.726533 7.81372 0.5 8.575L2.417 9.146C2.60454 8.51172 2.85478 7.89769 3.164 7.313V7.315ZM11 6V10.277C10.7004 10.4513 10.4513 10.7004 10.277 11H7V13H10.277C10.4297 13.2652 10.6414 13.4917 10.8958 13.662C11.1501 13.8323 11.4402 13.9417 11.7436 13.9818C12.047 14.0219 12.3556 13.9917 12.6454 13.8934C12.9353 13.7951 13.1986 13.6314 13.415 13.415C13.6314 13.1986 13.7951 12.9353 13.8934 12.6454C13.9917 12.3556 14.0219 12.047 13.9818 11.7436C13.9417 11.4402 13.8323 11.1501 13.662 10.8958C13.4917 10.6414 13.2652 10.4297 13 10.277V6H11Z"
                    fill="#252525"
                  />
                </svg>
              }
              className="uppercase"
              label={'TRANSACTION EXECUTION'}
              isReadonly
            />
          )}
        </div>


        {/* ============= Players in queue ============= */}
        <div
          className={
            'flex flex-row gap-4 font-plexsans text-[14px]/[14px] text-left-accent lg:hidden lg:text-[20px]/[20px]'
          }
        >
          <span className={'uppercase'}>Players in queue: {2}</span>
        </div>


        {/* ============= Game status/ opponent ============= */}
        <div className={'flex h-full w-full flex-col gap-4 lg:hidden'}>
          <span className={'w-full text-headline-2 font-bold'}>Game</span>
          <div
            className={
              'flex w-full gap-2 font-plexsans text-[16px]/[16px] uppercase text-left-accent lg:text-[20px]/[20px]'
            }
          >
            <span>Game status:</span>
            <span>{statuses[gameState]}</span>
          </div>
          <div
            className={
              'flex w-full items-center gap-2 font-plexsans text-[14px]/[14px] text-foreground lg:text-[20px]/[20px]'
            }
          >
            <span>Your opponent:</span>
            <span>{formatPubkey(matchQueue.gameInfo?.opponent)}</span>
          </div>
        </div>


        <Competition
          isPvp={true}
          startGame={restart}
          isRestartBtn={
            gameState === GameState.Lost ||
            gameState === GameState.Won ||
            gameState === GameState.OpponentTimeout
          }
          competition={{
            id: competition ? Number(competition.id) : 0,
            game: {
              id: battleshipsConfig.id,
              name: battleshipsConfig.name,
              rules: battleshipsConfig.rules,
              rating: getRatingQuery.data ? getRatingQuery.data.rating : null,
              author: battleshipsConfig.author,
            },
            title: lobbiesStore.activeLobby ? lobbiesStore.activeLobby.name : 'Unknown',
            reward: lobbiesStore.activeLobby ? Number(lobbiesStore.activeLobby.reward) : 0,
            currency: Currency.MINA,
            startPrice: lobbiesStore.lobbies?.[0] ? Number(lobbiesStore.lobbies[0].fee) : 0,
          }}
        />

      </motion.div>
    </GamePage>
  )
}
