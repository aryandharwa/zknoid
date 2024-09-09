import { Struct, Poseidon, Provable, UInt32, UInt64, Bool, PublicKey, Field, Circuit } from 'o1js';
import { state, runtimeMethod, runtimeModule } from '@proto-kit/module';
import { State, StateMap, assert } from '@proto-kit/protocol';
import { Lobby } from '../engine/LobbyManager';
import { UInt64 as ProtoUInt64 } from '@proto-kit/library';
import { MatchMaker } from '../engine/MatchMaker';
import { Balances } from 'src/framework';

const BOARD_SIZE = 10; // 10x10 board for Battleships

// Define the structure for a cell in the board
interface Cell {
  isShip: boolean; // Indicates if there is a ship in the cell
  isHit: boolean;  // Indicates if the cell has been hit
}

export class BattleshipsWinWitness extends Struct({
  hitCoordinates: Provable.Array(
    Struct({ x: UInt32, y: UInt32 }),
    BOARD_SIZE
  ), // Tracks the bomb hits
  shipCoordinates: Provable.Array(
    Struct({ x: UInt32, y: UInt32 }),
    BOARD_SIZE
  ), // Tracks the ship positions
  winner: PublicKey, // Add a winner property
}) {
  // Manually add the toFields method to convert the struct to Field[]
  toFields(): Field[] {
    return [
      ...this.hitCoordinates.flatMap(coord => [...coord.x.toFields(), ...coord.y.toFields()]),
      ...this.shipCoordinates.flatMap(coord => [...coord.x.toFields(), ...coord.y.toFields()]),
      ...this.winner.toFields(), // PublicKey also has toFields()
    ];
  }

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
  
   // Check if the player has won and return a BattleshipsWinWitness if true
   checkWin(shipPositions: { x: number; y: number }[], bombs: { x: number; y: number }[]): BattleshipsWinWitness | string {
    let hasWon = Bool(true);
  
    // Initialize hitCoordinates with correct Provable.Array types
    const hitCoordinates: { x: UInt32; y: UInt32 }[] = [];
    const shipCoordinates: { x: UInt32; y: UInt32 }[] = [];
  
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
  
    // Return a BattleshipsWinWitness if the player has won
    const emptyWinWitness = new BattleshipsWinWitness({
      hitCoordinates: [], // Use a plain empty array
      shipCoordinates: [], // Use a plain empty array
      winner: PublicKey.empty(), // Empty or default public key
    });
       
    const hitCoordArray = hitCoordinates.map(coord => ({
      x: UInt32.from(coord.x),
      y: UInt32.from(coord.y),
    }));
    
    const result = Provable.if(
      hasWon,
      new BattleshipsWinWitness({
        hitCoordinates: hitCoordArray.map(coord => ({
          x: UInt32.from(coord.x),
          y: UInt32.from(coord.y),
        })),
        shipCoordinates: shipCoordinates.map(coord => ({
          x: UInt32.from(coord.x),
          y: UInt32.from(coord.y),
        })),
        winner: PublicKey.empty(), // Set the winner as needed
      }),
      emptyWinWitness // Return an empty witness instead of null
    );
    
    
    
    
  
    return result;
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
    // Define the board as a 2D array
    private board: UInt32[][];
  
    // Adjust the constructor to call super() with the required argument
    constructor(balances: Balances) {
      super(balances); // Pass the required argument to the parent constructor
      // Initialize the board with a default size (e.g., 10x10) and values (e.g., 0 for empty)
      this.board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(UInt32.from(0)));
    }
  
    // // Method to check if the player has won and return a BattleshipsWinWitness if true
    // checkWin(shipPositions: { x: number; y: number }[], bombs: { x: number; y: number }[]): BattleshipsWinWitness | string {
    //   let hasWon = Bool(true);
  
    //   const hitCoordinates: { x: UInt32; y: UInt32 }[] = [];
    //   const shipCoordinates: { x: UInt32; y: UInt32 }[] = [];
  
    //   // Ensure all ship positions have been hit
    //   for (const ship of shipPositions) {
    //     const cell = this.board[ship.y][ship.x];
    //     hasWon = Bool.and(hasWon, cell.equals(UInt32.from(2))); // 2 represents a hit ship part
    //     shipCoordinates.push({ x: UInt32.from(ship.x), y: UInt32.from(ship.y) });
    //   }
  
    //   // Record all bomb hits
    //   for (const bomb of bombs) {
    //     const cell = this.board[bomb.y][bomb.x];
    //     const isHit = Provable.if(
    //       cell.equals(UInt32.from(2)),
    //       { x: UInt32.from(bomb.x), y: UInt32.from(bomb.y) },
    //       null
    //     );
    //     if (isHit) hitCoordinates.push(isHit);
    //   }
  
    //   // Return a BattleshipsWinWitness if the player has won
    //   const result = Provable.if(
    //     hasWon,
    //     new BattleshipsWinWitness({
    //       hitCoordinates: Provable.Array(Struct({ x: UInt32, y: UInt32 }), hitCoordinates.length).map((_, index) => hitCoordinates[index]),
    //       shipCoordinates: Provable.Array(Struct({ x: UInt32, y: UInt32 }), shipCoordinates.length).map((_, index) => shipCoordinates[index]),
    //       winner: PublicKey.empty(), // Set the winner as needed
    //     }),
    //     null // or another suitable value indicating no win
    //   );      
  
    //   return result;
    // }
  }
  
  
  
  
  
  
  
  
