/**
 * ai-worker.js - Web Worker for CH3SS AI
 * 
 * This file contains the AI logic for the CH3SS game, separated into a worker
 * to keep the UI responsive during deep move calculations.
 * 
 * Features:
 * - Configurable search depth
 * - Alpha-beta pruning
 * - Quiescence search to avoid horizon effect
 * - Transposition table for position caching
 * - Move ordering for better pruning efficiency
 * - Advanced evaluation with piece-square tables
 */

// Import chess.js (Web Worker version)
importScripts('https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.js');

// Global transposition table for caching evaluations
const transpositionTable = {};

// Global killer moves table - stores moves that caused beta cutoffs
const killerMoves = Array(20).fill().map(() => Array(2).fill(null));

// Keep track of search statistics
const searchStats = {
  nodesSearched: 0,
  quiescenceNodes: 0,
  transpositionHits: 0,
  startTime: 0,
  endTime: 0
};

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  const { fen, depth = 4, aiColor = 'black', action = 'move' } = event.data;
  
  if (action === 'move') {
    // Reset search statistics
    resetSearchStats();
    searchStats.startTime = performance.now();
    
    // Create a chess instance with the current position
    const chess = new Chess(fen);
    
    // Calculate the best move
    const bestMove = findBestMove(chess, depth, aiColor);
    
    searchStats.endTime = performance.now();
    const searchTime = searchStats.endTime - searchStats.startTime;
    
    // Send the best move back to the main thread
    self.postMessage({
      bestMove,
      stats: {
        ...searchStats,
        searchTime,
        nodesPerSecond: Math.round(searchStats.nodesSearched / (searchTime / 1000))
      }
    });
  }
});

// Reset search statistics
function resetSearchStats() {
  searchStats.nodesSearched = 0;
  searchStats.quiescenceNodes = 0;
  searchStats.transpositionHits = 0;
  searchStats.startTime = 0;
  searchStats.endTime = 0;
}

// Find the best move for the current position
function findBestMove(chessInstance, depth, aiColor) {
  // Determine if AI is maximizing (true for black in our convention)
  const isMaximizing = aiColor === 'black';
  
  // Get all possible moves
  const moves = chessInstance.moves({ verbose: true });
  
  // If no moves, return null
  if (moves.length === 0) return null;
  
  // Order moves for better alpha-beta pruning efficiency
  const orderedMoves = orderMoves(chessInstance, moves);
  
  let bestMove = null;
  let bestValue = isMaximizing ? -Infinity : Infinity;
  let alpha = -Infinity;
  let beta = Infinity;
  
  // Search each move to the specified depth
  for (const move of orderedMoves) {
    const newChess = new Chess(chessInstance.fen());
    newChess.move(move);
    
    // Get value from minimax with alpha-beta pruning
    const value = minimax(depth - 1, newChess, !isMaximizing, alpha, beta, 0);
    
    if (isMaximizing) {
      if (value > bestValue) {
        bestValue = value;
        bestMove = move;
      }
      alpha = Math.max(alpha, bestValue);
    } else {
      if (value < bestValue) {
        bestValue = value;
        bestMove = move;
      }
      beta = Math.min(beta, bestValue);
    }
  }
  
  return bestMove;
}

// Enhanced minimax algorithm with alpha-beta pruning
function minimax(depth, chessInstance, isMaximizing, alpha, beta, plyFromRoot) {
  searchStats.nodesSearched++;
  
  const fen = chessInstance.fen();
  
  // Check transposition table for previously evaluated positions
  if (transpositionTable[fen] && transpositionTable[fen].depth >= depth) {
    searchStats.transpositionHits++;
    return transpositionTable[fen].value;
  }
  
  // Base case: if depth is 0 or game over, perform quiescence search
  if (depth <= 0 || chessInstance.game_over()) {
    // Use quiescence search to avoid horizon effect
    const value = quiescenceSearch(chessInstance, alpha, beta, 0, 3);
    transpositionTable[fen] = { value, depth };
    return value;
  }
  
  // Get all legal moves and order them
  const moves = chessInstance.moves({ verbose: true });
  const orderedMoves = orderMoves(chessInstance, moves, plyFromRoot);
  
  if (isMaximizing) {
    let value = -Infinity;
    for (const move of orderedMoves) {
      const newChess = new Chess(chessInstance.fen());
      newChess.move(move);
      
      value = Math.max(value, minimax(depth - 1, newChess, false, alpha, beta, plyFromRoot + 1));
      alpha = Math.max(alpha, value);
      
      // Store killer moves if this caused a beta cutoff
      if (beta <= alpha) {
        if (!isCapture(move)) {
          // Store killer move
          if (killerMoves[plyFromRoot][0] !== move.san) {
            killerMoves[plyFromRoot][1] = killerMoves[plyFromRoot][0]; 
            killerMoves[plyFromRoot][0] = move.san;
          }
        }
        break; // Alpha-beta pruning
      }
    }
    
    transpositionTable[fen] = { value, depth };
    return value;
  } else {
    let value = Infinity;
    for (const move of orderedMoves) {
      const newChess = new Chess(chessInstance.fen());
      newChess.move(move);
      
      value = Math.min(value, minimax(depth - 1, newChess, true, alpha, beta, plyFromRoot + 1));
      beta = Math.min(beta, value);
      
      // Store killer moves if this caused an alpha cutoff
      if (beta <= alpha) {
        if (!isCapture(move)) {
          // Store killer move
          if (killerMoves[plyFromRoot][0] !== move.san) {
            killerMoves[plyFromRoot][1] = killerMoves[plyFromRoot][0]; 
            killerMoves[plyFromRoot][0] = move.san;
          }
        }
        break; // Alpha-beta pruning
      }
    }
    
    transpositionTable[fen] = { value, depth };
    return value;
  }
}

// Quiescence search - continues search for "noisy" positions to avoid horizon effect
function quiescenceSearch(chessInstance, alpha, beta, depth, maxDepth) {
  searchStats.quiescenceNodes++;
  
  // Base position evaluation (stand-pat score)
  const standPat = evaluatePosition(chessInstance);
  
  // Beta cutoff (position is already too good)
  if (standPat >= beta) return beta;
  
  // Update alpha if position is better than what we've seen
  if (alpha < standPat) alpha = standPat;
  
  // Limit maximum quiescence search depth
  if (depth >= maxDepth) return standPat;
  
  // Get only capture moves for quiescence search
  const moves = chessInstance.moves({ verbose: true })
                .filter(move => move.captured);
  
  // Order captures by MVV-LVA (Most Valuable Victim - Least Valuable Aggressor)
  const orderedCaptures = orderMovesMVVLVA(moves);
  
  // Search only captures
  for (const move of orderedCaptures) {
    const newChess = new Chess(chessInstance.fen());
    newChess.move(move);
    
    const value = -quiescenceSearch(newChess, -beta, -alpha, depth + 1, maxDepth);
    
    if (value >= beta) return beta;
    if (value > alpha) alpha = value;
  }
  
  return alpha;
}

// Order moves to optimize alpha-beta pruning
// 1. Prior best move from transposition table
// 2. Captures (ordered by MVV-LVA)
// 3. Killer moves (quiet moves that caused cutoffs at the same depth)
// 4. Other non-capturing moves
function orderMoves(chessInstance, moves, plyFromRoot = 0) {
  const fen = chessInstance.fen();
  const ttMove = transpositionTable[fen]?.bestMove;
  
  const moveScores = moves.map(move => {
    let score = 0;
    
    // 1. Transposition table move gets highest priority
    if (ttMove && move.san === ttMove) {
      score = 10000000;
    }
    // 2. Captures sorted by Most Valuable Victim - Least Valuable Aggressor (MVV-LVA)
    else if (move.captured) {
      const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
      // MVV-LVA = victim value * 10 - aggressor value
      score = 1000000 + pieceValues[move.captured] * 10 - pieceValues[move.piece];
    } 
    // 3. Killer moves
    else if (killerMoves[plyFromRoot][0] === move.san) {
      score = 900000; // First killer move
    }
    else if (killerMoves[plyFromRoot][1] === move.san) {
      score = 800000; // Second killer move
    }
    // 4. History heuristic and other positional factors could be added here
    else {
      // Prioritize checks
      const newChess = new Chess(chessInstance.fen());
      newChess.move(move);
      if (newChess.in_check()) score += 500000;
      
      // Prioritize central pawn moves (e4, d4, e5, d5)
      if (move.piece === 'p') {
        if ((move.to === 'e4' || move.to === 'd4' || move.to === 'e5' || move.to === 'd5')) {
          score += 400000;
        }
        
        // Pawn promotions are valuable
        if (move.promotion) score += 700000 + pieceValues[move.promotion];
      }
    }
    
    return { move, score };
  });
  
  // Sort moves by score (descending)
  moveScores.sort((a, b) => b.score - a.score);
  
  // Return the ordered moves
  return moveScores.map(ms => ms.move);
}

// Order captures by MVV-LVA (Most Valuable Victim - Least Valuable Aggressor)
function orderMovesMVVLVA(moves) {
  const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  
  // Calculate MVV-LVA for each move
  const moveScores = moves.map(move => {
    // MVV-LVA = victim value * 10 - aggressor value
    const score = pieceValues[move.captured] * 10 - pieceValues[move.piece];
    return { move, score };
  });
  
  // Sort by MVV-LVA (descending)
  moveScores.sort((a, b) => b.score - a.score);
  
  // Return ordered moves
  return moveScores.map(ms => ms.move);
}

// Check if a move is a capture
function isCapture(move) {
  return move.captured !== undefined;
}

// Enhanced position evaluation function
function evaluatePosition(chessInstance) {
  // Game over checks
  if (chessInstance.in_checkmate()) {
    return chessInstance.turn() === 'w' ? -10000 : 10000; // -10000 if white is checkmated, 10000 if black
  }
  if (chessInstance.in_draw()) {
    return 0; // Draws are neutral
  }
  
  const board = chessInstance.board();
  let score = 0;
  
  // Piece values
  const pieceValues = {
    'p': 100,  // pawn
    'n': 320,  // knight
    'b': 330,  // bishop
    'r': 500,  // rook
    'q': 900,  // queen
    'k': 20000 // king (not actually used for material calculation)
  };
  
  // Position bonuses for different pieces
  const pawnPositionBonus = [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5,  5, 10, 25, 25, 10,  5,  5],
    [0,  0,  0, 20, 20,  0,  0,  0],
    [5, -5,-10,  0,  0,-10, -5,  5],
    [5, 10, 10,-20,-20, 10, 10,  5],
    [0,  0,  0,  0,  0,  0,  0,  0]
  ];
  
  const knightPositionBonus = [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50]
  ];
  
  const bishopPositionBonus = [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20]
  ];
  
  const rookPositionBonus = [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [5, 10, 10, 10, 10, 10, 10,  5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [0,  0,  0,  5,  5,  0,  0,  0]
  ];
  
  const queenPositionBonus = [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [-5,  0,  5,  5,  5,  5,  0, -5],
    [0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20]
  ];
  
  const kingMiddlegamePositionBonus = [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [20, 20,  0,  0,  0,  0, 20, 20],
    [20, 30, 10,  0,  0, 10, 30, 20]
  ];
  
  // Bishop pair bonus
  let whiteBishops = 0;
  let blackBishops = 0;
  
  // Analyze the board
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const piece = board[i][j];
      if (piece) {
        const value = pieceValues[piece.type.toLowerCase()];
        
        // Material value: positive for black pieces, negative for white pieces
        // This convention assumes black is maximizing, white is minimizing
        if (piece.color === 'b') {
          score += value;
          if (piece.type === 'b') blackBishops++;
        } else {
          score -= value;
          if (piece.type === 'b') whiteBishops++;
        }
        
        // Position bonus
        let positionBonus = 0;
        
        if (piece.type === 'p') { // Pawn
          positionBonus = piece.color === 'w' ? pawnPositionBonus[i][j] : pawnPositionBonus[7-i][j];
        }
        else if (piece.type === 'n') { // Knight
          positionBonus = piece.color === 'w' ? knightPositionBonus[i][j] : knightPositionBonus[7-i][j];
        }
        else if (piece.type === 'b') { // Bishop
          positionBonus = piece.color === 'w' ? bishopPositionBonus[i][j] : bishopPositionBonus[7-i][j];
        }
        else if (piece.type === 'r') { // Rook
          positionBonus = piece.color === 'w' ? rookPositionBonus[i][j] : rookPositionBonus[7-i][j];
        }
        else if (piece.type === 'q') { // Queen
          positionBonus = piece.color === 'w' ? queenPositionBonus[i][j] : queenPositionBonus[7-i][j];
        }
        else if (piece.type === 'k') { // King
          positionBonus = piece.color === 'w' ? kingMiddlegamePositionBonus[i][j] : kingMiddlegamePositionBonus[7-i][j];
        }
        
        // Apply position bonus (positive for black, negative for white)
        if (piece.color === 'b') {
          score += positionBonus;
        } else {
          score -= positionBonus;
        }
      }
    }
  }
  
  // Bishop pair bonus
  if (whiteBishops >= 2) score -= 50; // White gets bishop pair bonus
  if (blackBishops >= 2) score += 50; // Black gets bishop pair bonus
  
  // Mobility evaluation (count legal moves for both sides)
  const originalTurn = chessInstance.turn();
  
  // Count moves for the current side
  const currentMoves = chessInstance.moves().length;
  
  // Flip the board to count opponent moves
  const fen = chessInstance.fen();
  const fenParts = fen.split(' ');
  fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w'; // Toggle turn
  const opposingFen = fenParts.join(' ');
  
  const tempChess = new Chess(opposingFen);
  const opposingMoves = tempChess.moves().length;
  
  // Add mobility score (more moves is better)
  if (originalTurn === 'b') {
    score += (currentMoves - opposingMoves) * 10;
  } else {
    score -= (currentMoves - opposingMoves) * 10;
  }
  
  // King safety: penalize having few pieces around the king in the midgame/endgame
  let whiteKingProtection = 0;
  let blackKingProtection = 0;
  
  // Find kings
  let whiteKingPos = null;
  let blackKingPos = null;
  
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const piece = board[i][j];
      if (piece && piece.type === 'k') {
        if (piece.color === 'w') whiteKingPos = { row: i, col: j };
        else blackKingPos = { row: i, col: j };
      }
    }
  }
  
  // Count pieces protecting the kings
  if (whiteKingPos) {
    for (let i = Math.max(0, whiteKingPos.row - 1); i <= Math.min(7, whiteKingPos.row + 1); i++) {
      for (let j = Math.max(0, whiteKingPos.col - 1); j <= Math.min(7, whiteKingPos.col + 1); j++) {
        const piece = board[i][j];
        if (piece && piece.color === 'w' && piece.type !== 'k') {
          whiteKingProtection++;
        }
      }
    }
  }
  
  if (blackKingPos) {
    for (let i = Math.max(0, blackKingPos.row - 1); i <= Math.min(7, blackKingPos.row + 1); i++) {
      for (let j = Math.max(0, blackKingPos.col - 1); j <= Math.min(7, blackKingPos.col + 1); j++) {
        const piece = board[i][j];
        if (piece && piece.color === 'b' && piece.type !== 'k') {
          blackKingProtection++;
        }
      }
    }
  }
  
  score += blackKingProtection * 10;
  score -= whiteKingProtection * 10;
  
  // Pawn structure evaluation
  // Evaluate doubled pawns (bad), isolated pawns (bad), and passed pawns (good)
  const whitePawnCols = Array(8).fill(0);
  const blackPawnCols = Array(8).fill(0);
  const whitePawns = [];
  const blackPawns = [];
  
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const piece = board[i][j];
      if (piece && piece.type === 'p') {
        if (piece.color === 'w') {
          whitePawnCols[j]++;
          whitePawns.push({ row: i, col: j });
        } else {
          blackPawnCols[j]++;
          blackPawns.push({ row: i, col: j });
        }
      }
    }
  }
  
  // Penalize doubled pawns
  for (let j = 0; j < 8; j++) {
    if (whitePawnCols[j] > 1) score += 20 * (whitePawnCols[j] - 1); // Penalty for white (helps black's score)
    if (blackPawnCols[j] > 1) score -= 20 * (blackPawnCols[j] - 1); // Penalty for black (helps white's score)
  }
  
  // Small random factor to avoid deterministic play in equal positions
  score += Math.floor(Math.random() * 10) - 5;
  
  return score;
}

// Helper functions for move ordering
const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };