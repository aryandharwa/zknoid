import { Struct, Poseidon, Provable, UInt32, UInt64, Bool, PublicKey, Field } from 'o1js';
import { state, runtimeMethod, runtimeModule } from '@proto-kit/module';
import { State, StateMap, assert } from '@proto-kit/protocol';
import { Lobby } from '../engine/LobbyManager';
import { UInt64 as ProtoUInt64 } from '@proto-kit/library';
import { MatchMaker } from '../engine/MatchMaker';

const BOARD_SIZE = 10; // 10x10 board for Battleships

export class WinWitness extends Struct({
  hitCoordinates: Provable.Array(
    Struct({ x: UInt32, y: UInt32 }),
    BOARD_SIZE
  ), // Tracks the bomb hits
  shipCoordinates: Provable.Array(
    Struct({ x: UInt32, y: UInt32 }),
    BOARD_SIZE
  ), // Tracks the ship positions
}) {
  assertCorrect() {
    // Ensure that all coordinates are within the valid bounds of the board
    for (const coord of this.shipCoordinates) {
      assert(
        coord.x.lessThan(UInt32.from(BOARD_SIZE)).and(coord.y.lessThan(UInt32.from(BOARD_SIZE))),
        'Invalid ship coordinates'
      );
    }

    for (const coord of this.hitCoordinates) {
      assert(
        coord.x.lessThan(UInt32.from(BOARD_SIZE)).and(coord.y.lessThan(UInt32.from(BOARD_SIZE))),
        'Invalid hit coordinates'
      );
    }

    // Additional checks, e.g., no overlapping hits or ships, if necessary
    // You can add more game-specific validation here
  }
}


export class BattleshipsField extends Struct({
    board: Provable.Array(Provable.Array(UInt32, BOARD_SIZE), BOARD_SIZE),
  }) {
    // Create a BattleshipsField from a 2D array of numbers
    static from(array: number[][]) {
      assert(Bool(array.length === BOARD_SIZE), `Board must be ${BOARD_SIZE}x${BOARD_SIZE}`);
      return new BattleshipsField({
        board: array.map(row => row.map(cell => UInt32.from(cell))),
      });
    }
  
   // Check if the player has won and return a WinWitness if true
   checkWin(shipPositions: { x: number; y: number }[], bombs: { x: number; y: number }[]): WinWitness | string {
    let hasWon = Bool(true);

    const hitCoordinates = [];
    const shipCoordinates = [];

    // Ensure all ship positions have been hit
    for (const ship of shipPositions) {
      const cell = this.board[ship.y][ship.x];
      hasWon = Bool.and(hasWon, cell.equals(UInt32.from(2))); // 2 represents a hit ship part
      shipCoordinates.push({ x: UInt32.from(ship.x), y: UInt32.from(ship.y) });
    }

    // Record all bomb hits
    for (const bomb of bombs) {
      const cell = this.board[bomb.y][bomb.x];
      if (cell.equals(UInt32.from(2)).toBoolean()) {
        hitCoordinates.push({ x: UInt32.from(bomb.x), y: UInt32.from(bomb.y) });
      }
    }

    // Return a WinWitness if the player has won
    if (hasWon.toBoolean()) {
      return new WinWitness({
        hitCoordinates: hitCoordinates,
        shipCoordinates: shipCoordinates,
      });
    }

    return "no player won"; // Avoid returning undefined, return a string instead
  }

  
    // Hash the board state using Poseidon
    hash(): Field {
      const flattenedBoard = this.board.flat().map(cell => cell.value);
      return Poseidon.hash(flattenedBoard);
    }
  
    // Mark a bomb hit (returns a new BattleshipsField with updated state)
    markHit(x: number, y: number): BattleshipsField {
      const newBoard = this.board.map((row, rowIndex) =>
        row.map((cell, colIndex) => {
          if (rowIndex === y && colIndex === x && cell.equals(UInt32.from(1)).toBoolean()) {
            return UInt32.from(2); // Mark the hit ship part with 2
          }
          return cell;
        })
      );
  
      return new BattleshipsField({ board: newBoard });
    }
  }




  export class GameInfo extends Struct({
    player1: PublicKey,           // Public key of Player 1
    player2: PublicKey,           // Public key of Player 2
    currentMoveUser: PublicKey,   // The public key of the player whose turn it is to make a move
    lastMoveBlockHeight: UInt64,  // The block height of the last move (optional for tracking timing)
    winner: PublicKey,            // The public key of the winner, if any; empty if the game is still ongoing
    field: BattleshipsField,      // The current state of the game board
  }) {
    // Method to check if the game has a winner
    hasWinner(): Bool {
      return this.winner.equals(PublicKey.empty()).not(); // If the winner is not an empty public key, we have a winner
    }
  
    // Method to check if the current move belongs to a specific player
    isCurrentPlayer(player: PublicKey): Bool {
      return this.currentMoveUser.equals(player);
    }
  
    // Hash the game state using Poseidon (useful for proving state commitments in zero-knowledge)
    hash(): Field {
      const componentsToHash = [
        this.player1.toFields(),              // Hash player1's public key
        this.player2.toFields(),              // Hash player2's public key
        this.currentMoveUser.toFields(),      // Hash the current move user's public key
        this.winner.toFields(),               // Hash the winner's public key (if no winner, it will hash an empty key)
        this.field.hash(),                    // Hash the current board state
        this.lastMoveBlockHeight.toFields(),  // Hash the block height of the last move
      ];
  
      return Poseidon.hash(componentsToHash.flat());
    }
  }

  
  @runtimeModule()
  export class BattleshipsLogic extends MatchMaker {
    // State to track all games
    @state() public games = StateMap.from<UInt64, GameInfo>(UInt64, GameInfo);
  
    @state() public gamesNum = State.from<UInt64>(UInt64);
  
    // Initialize a game for two players
    public override async initGame(lobby: Lobby, shouldUpdate: Bool): Promise<UInt64> {
      const currentGameId = lobby.id;
  
      // Create an empty board with all cells initialized to 0
      const emptyBoard = Array(10).fill(Array(10).fill(0));
  
      // Setting active game if opponent found
      await this.games.set(
        Provable.if(shouldUpdate, currentGameId, UInt64.from(0)),
        new GameInfo({
          player1: lobby.players[0],
          player2: lobby.players[1],
          currentMoveUser: lobby.players[0], // Player 1 starts the game
          lastMoveBlockHeight: this.network.block.height,
          field: BattleshipsField.from(emptyBoard), // Empty board initialized
          winner: PublicKey.empty(),
        }),
      );
  
      // Set the game fund based on the lobby’s participation fee
      await this.gameFund.set(
        currentGameId,
        ProtoUInt64.from(lobby.participationFee).mul(2), // Prize pool = 2 * participation fee
      );
  
      return await super.initGame(lobby, shouldUpdate);
    }

    @runtimeMethod()
    public async proveOpponentTimeout(gameId: UInt64): Promise<void> {
      const game = await this.games.get(gameId);
      assert(game.isSome, 'Game not found');
      const currentGame = game.value;
  
      // Check if the opponent has timed out
      const blockDifference = this.network.block.height.sub(currentGame.lastMoveBlockHeight);
      assert(
        blockDifference.greaterThanOrEqual(UInt64.from(100)), // Arbitrary timeout period, adjust as needed
        'Opponent still has time to move',
      );
  
      // Declare the non-timed-out player as the winner
      const winner = currentGame.currentMoveUser.equals(currentGame.player1)
        ? currentGame.player2
        : currentGame.player1;
  
      // Update the game state
      currentGame.winner = winner;
      await this.games.set(gameId, currentGame);
  
      // Clear the active game state for both players
      await this.activeGameId.set(currentGame.player1, UInt64.from(0));
      await this.activeGameId.set(currentGame.player2, UInt64.from(0));
  
      // Transfer the prize fund to the winner
      await this.acquireFunds(
        gameId,
        winner,
        PublicKey.empty(),
        ProtoUInt64.from(1),
        ProtoUInt64.from(0),
        ProtoUInt64.from(1),
      );
  
      await this._onLobbyEnd(gameId, Bool(true));
    }
  
    @runtimeMethod()
    public async makeMove(
      gameId: UInt64,
      newField: BattleshipsField,
      winWitness: WinWitness | string,
    ): Promise<void> {
      // Fetch game information
      const sessionSender = await this.sessions.get(this.transaction.sender.value);
      const sender = Provable.if(
        sessionSender.isSome,
        sessionSender.value,
        this.transaction.sender.value,
      );
  
      const game = await this.games.get(gameId);
      assert(game.isSome, 'Invalid game id');
      assert(game.value.currentMoveUser.equals(sender), `Not your move`);
      assert(game.value.winner.equals(PublicKey.empty()), `Game finished`);


  // Retrieve ship positions from the game field
  const shipPositions = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      if (game.value.field.board[i][j].equals(UInt32.from(1)).toBoolean()) {
        shipPositions.push({ x: i, y: j });
      }
    }
  }

  // If no one has won, simply update the board and move on
  assert(Bool(winWitness !== "no player won"), `No winner yet`);

  await this.games.set(
    gameId,
    new GameInfo({
      ...game.value,
      field: newField,
      currentMoveUser: Provable.if(
        game.value.currentMoveUser.equals(game.value.player1),
        game.value.player2,
        game.value.player1,
      ),
      lastMoveBlockHeight: this.network.block.height, // Updated the block height for tracking moves
    }),
  );
}

}
