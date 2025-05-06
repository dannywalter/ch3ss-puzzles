/**
 * ai-worker.js - Web Worker for CH3SS AI
 * 
 * This file contains the AI logic for the CH3SS game, separated into a worker
 * to keep the UI responsive during deep move calculations.
 * 
 */

// Load chess.js inside the worker
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js');
    if (typeof Chess === 'undefined') {
      console.error('[Worker] CRITICAL: chess.js failed to load');
      self.postMessage({ error: 'Chess library failed to load in worker' });
      self.close();
    }

    // --- Tiny Opening Book + Fisher–Yates Shuffle + FEN Normalizer ---
    const openingBook = {
      // 1. White’s 10 most popular first‑moves (White to move)
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w": [
        { from: "e2", to: "e4" },
        { from: "d2", to: "d4" },
        { from: "g1", to: "f3" },
        { from: "c2", to: "c4" },
        { from: "g2", to: "g3" },
        { from: "b1", to: "c3" },
        { from: "b2", to: "b3" },
        { from: "f2", to: "f4" },
        { from: "e2", to: "e3" },
        { from: "d2", to: "d3" }
      ],

      // Black replies to 1.e4
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b": [
        { from: "e7", to: "e5" },
        { from: "c7", to: "c5" },
        { from: "e7", to: "e6" },
        { from: "g8", to: "f6" }
      ],

      // Black replies to 1.d4
      "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b": [
        { from: "d7", to: "d5" },
        { from: "g8", to: "f6" },
        { from: "e7", to: "e6" },
        { from: "c7", to: "c6" }
      ],

      // Black replies to 1.Nf3
      "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b": [
        { from: "g8", to: "f6" },
        { from: "d7", to: "d5" },
        { from: "e7", to: "e6" },
        { from: "c7", to: "c5" }
      ],

      // Black replies to 1.c4
      "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b": [
        { from: "e7", to: "e5" },
        { from: "c7", to: "c5" },
        { from: "g8", to: "f6" },
        { from: "e7", to: "e6" }
      ],

      // Black replies to 1.g3
      "rnbqkbnr/pppppppp/8/8/8/6P1/PPPPPP1P/RNBQKBNR b": [
        { from: "e7", to: "e5" },
        { from: "g8", to: "f6" },
        { from: "d7", to: "d5" },
        { from: "e7", to: "e6" }
      ],

      // Black replies to 1.Nc3
      "rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/R1BQKBNR b": [
        { from: "g8", to: "f6" },
        { from: "d7", to: "d5" },
        { from: "e7", to: "e6" },
        { from: "c7", to: "c5" }
      ],

      // Black replies to 1.b3
      "rnbqkbnr/pppppppp/8/8/1P6/8/P1PPPPPP/RNBQKBNR b": [
        { from: "e7", to: "e5" },
        { from: "d7", to: "d5" },
        { from: "g8", to: "f6" },
        { from: "e7", to: "e6" }
      ],

      // Black replies to 1.f4
      "rnbqkbnr/pppppppp/8/8/5P2/8/PPPPP1PP/RNBQKBNR b": [
        { from: "e7", to: "e5" },
        { from: "g8", to: "f6" },
        { from: "d7", to: "d5" },
        { from: "e7", to: "e6" }
      ],

      // Black replies to 1.e3
      "rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR b": [
        { from: "e7", to: "e5" },
        { from: "c7", to: "c5" },
        { from: "d7", to: "d5" },
        { from: "g8", to: "f6" }
      ],

      // Black replies to 1.d3
      "rnbqkbnr/pppppppp/8/8/8/3P4/PPPP1PPP/RNBQKBNR b": [
        { from: "d7", to: "d5" },
        { from: "g8", to: "f6" },
        { from: "e7", to: "e6" },
        { from: "c7", to: "c6" }
      ],

    // Punish single‑pawn blunder 1.g4 with …e6
    "rnbqkbnr/pppppppp/8/8/6P1/8/PPPPPP1P/RNBQKBNR b": [
      { from: "e7", to: "e6" }
    ],

    // Punish single‑pawn blunder 1.f3 with …e6
    "rnbqkbnr/pppppppp/8/8/8/5P2/PPPPP1PP/RNBQKBNR b": [
      { from: "e7", to: "e6" }
    ],

    // 2. Fool’s Mate (after f3+g4 or g4+f3, Black has played e6 already; Black to move)
      "rnbqkbnr/pppp1ppp/4p3/8/6P1/5P2/PPPP1PPP/RNBQKBNR b": [
        { from: "d8", to: "h4" }  // …Qh4#
      ],

      // 3. Scholar’s Mate pre‑mate position (Black to move)
      "rnbqkbnr/pppp1ppp/2n2n2/4pQ2/2B1P3/8/PPPP1PPP/RNB1K1NR b": [
        { from: "d8", to: "h4" }
      ],

      // 4. Blackburne–Shilling Trap pre‑mate (Black to move)
      "r1bqkbnr/pppp1ppp/8/4Q3/3nB3/8/PPPP1PPP/RNB1K1NR b": [
        { from: "g5", to: "e5" }
      ],

      // 5. Legal’s Mate pre‑mate (Black to move)
      "r1bqk1nr/pppp1ppp/3p4/4N3/2B1b3/4P3/PPPP1PPP/RNBQK2R b": [
        { from: "d7", to: "d5" }
      ]
    };

    function shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    }

    // Strip full FEN down to exactly "piece‑placement + side‑to‑move"
    function normalizeFen(fen) {
      const parts = fen.split(' ');
      return parts[0] + ' ' + parts[1];
    }
    // --- end opening book/shuffle/normalizer ---

    // MVV/LVA + Killer Moves
    const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

    // Assign capture scores: (victim*10 − attacker)
    function scoreCapture(move) {
      if (!move.captured) return 0;
      const victim   = PIECE_VALUE[move.captured.toLowerCase()] || 0;
      const attacker = PIECE_VALUE[move.piece.toLowerCase()]    || 0;
      return (victim * 10) - attacker;
    }

    // Compare two moves for exact match
    function sameMove(a, b) {
      return b &&
             a.from === b.from &&
             a.to   === b.to &&
             a.promotion === b.promotion;
    }

    // Two “killer” slots per depth
    const MAX_DEPTH   = 4;  // should exceed your search ply
    const killerMoves = Array.from({ length: MAX_DEPTH }, () => [null, null]);

    // Order moves: captures first (MVV/LVA), then killer moves, then the rest
    function orderMoves(moves, depth) {
      const [k1, k2] = killerMoves[depth] || [null, null];
      return moves.sort((a, b) => {
        const ca = scoreCapture(a), cb = scoreCapture(b);
        if (ca || cb) return cb - ca;       // non‑zero capture scores first
        if (sameMove(a, k1)) return -1;     // killer #1
        if (sameMove(b, k1)) return  1;
        if (sameMove(a, k2)) return -1;     // killer #2
        if (sameMove(b, k2)) return  1;
        return 0;                           // otherwise original order
      });
    }

    // --- AI Logic from Example (Adapted) ---

    // Reverse a table for Black’s side
    var reverseArray = array => JSON.parse(JSON.stringify(array)).reverse();

    // --- Piece‑Square Tables ---
    var pawnEvalWhite = [
      [0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0],
      [5.0,  5.0,  5.0,  5.0,  5.0,  5.0,  5.0,  5.0],
      [1.0,  1.0,  2.0,  3.0,  3.0,  2.0,  1.0,  1.0],
      [0.5,  0.5,  1.0,  2.5,  2.5,  1.0,  0.5,  0.5],
      [0.0,  0.0,  0.0,  2.0,  2.0,  0.0,  0.0,  0.0],
      [0.5, -0.5, -1.0,  0.0,  0.0, -1.0, -0.5,  0.5],
      [0.5,  1.0,  1.0, -2.0, -2.0,  1.0,  1.0,  0.5],
      [0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0]
    ];
    var pawnEvalBlack = reverseArray(pawnEvalWhite);

    var knightEval = [
      [-5.0, -4.0, -3.0, -3.0, -3.0, -3.0, -4.0, -5.0],
      [-4.0, -2.0,  0.0,  0.0,  0.0,  0.0, -2.0, -4.0],
      [-3.0,  0.0,  1.0,  1.5,  1.5,  1.0,  0.0, -3.0],
      [-3.0,  0.5,  1.5,  2.0,  2.0,  1.5,  0.5, -3.0],
      [-3.0,  0.0,  1.5,  2.0,  2.0,  1.5,  0.0, -3.0],
      [-3.0,  0.5,  1.0,  1.5,  1.5,  1.0,  0.5, -3.0],
      [-4.0, -2.0,  0.0,  0.5,  0.5,  0.0, -2.0, -4.0],
      [-5.0, -4.0, -3.0, -3.0, -3.0, -3.0, -4.0, -5.0]
    ];

    var bishopEvalWhite = [
      [-2.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -2.0],
      [-1.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -1.0],
      [-1.0,  0.0,  0.5,  1.0,  1.0,  0.5,  0.0, -1.0],
      [-1.0,  0.5,  0.5,  1.0,  1.0,  0.5,  0.5, -1.0],
      [-1.0,  0.0,  1.0,  1.0,  1.0,  1.0,  0.0, -1.0],
      [-1.0,  1.0,  1.0,  1.0,  1.0,  1.0,  1.0, -1.0],
      [-1.0,  0.5,  0.0,  0.0,  0.0,  0.0,  0.5, -1.0],
      [-2.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -2.0]
    ];
    var bishopEvalBlack = reverseArray(bishopEvalWhite);

    var rookEvalWhite = [
      [  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0],
      [  0.5,  1.0,  1.0,  1.0,  1.0,  1.0,  1.0,  0.5],
      [ -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -0.5],
      [ -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -0.5],
      [ -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -0.5],
      [ -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -0.5],
      [ -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -0.5],
      [  0.0,  0.0,  0.0,  0.5,  0.5,  0.0,  0.0,  0.0]
    ];
    var rookEvalBlack = reverseArray(rookEvalWhite);

    var evalQueen = [
      [ -2.0, -1.0, -1.0, -0.5, -0.5, -1.0, -1.0, -2.0],
      [ -1.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -1.0],
      [ -1.0,  0.0,  0.5,  0.5,  0.5,  0.5,  0.0, -1.0],
      [ -0.5,  0.0,  0.5,  0.5,  0.5,  0.5,  0.0, -0.5],
      [  0.0,  0.0,  0.5,  0.5,  0.5,  0.5,  0.0, -0.5],
      [ -1.0,  0.5,  0.5,  0.5,  0.5,  0.5,  0.0, -1.0],
      [ -1.0,  0.0,  0.5,  0.0,  0.0,  0.0,  0.0, -1.0],
      [ -2.0, -1.0, -1.0, -0.5, -0.5, -1.0, -1.0, -2.0]
    ];

    var kingEvalWhite = [
      [ -3.0, -4.0, -4.0, -5.0, -5.0, -4.0, -4.0, -3.0],
      [ -3.0, -4.0, -4.0, -5.0, -5.0, -4.0, -4.0, -3.0],
      [ -3.0, -4.0, -4.0, -5.0, -5.0, -4.0, -4.0, -3.0],
      [ -3.0, -4.0, -4.0, -5.0, -5.0, -4.0, -4.0, -3.0],
      [ -2.0, -3.0, -3.0, -4.0, -4.0, -3.0, -3.0, -2.0],
      [ -1.0, -2.0, -2.0, -2.0, -2.0, -2.0, -2.0, -1.0],
      [  2.0,  2.0,  0.0,  0.0,  0.0,  0.0,  2.0,  2.0],
      [  2.0,  3.0,  1.0,  0.0,  0.0,  1.0,  3.0,  2.0]
    ];
    var kingEvalBlack = reverseArray(kingEvalWhite);

    // Absolute piece value (no sign)
    var getPieceValue = function(piece, x, y) {
      if (!piece) return 0;
      var isWhite = piece.color === 'w';
      var t = piece.type;
      if (t === 'p') return 10 + (isWhite ? pawnEvalWhite[y][x] : pawnEvalBlack[y][x]);
      if (t === 'r') return 50 + (isWhite ? rookEvalWhite[y][x] : rookEvalBlack[y][x]);
      if (t === 'n') return 30 + knightEval[y][x];
      if (t === 'b') return 30 + (isWhite ? bishopEvalWhite[y][x] : bishopEvalBlack[y][x]);
      if (t === 'q') return 90 + evalQueen[y][x];
      if (t === 'k') return 9000 + (isWhite ? kingEvalWhite[y][x] : kingEvalBlack[y][x]);
      return 0;
    };

    // Material + positional eval from White’s POV
    var evaluateBoard = function(board) {
      var total = 0;
      for (var y = 0; y < 8; y++) {
        for (var x = 0; x < 8; x++) {
          var p = board[y][x];
          if (p) {
            var v = getPieceValue(p, x, y);
            total += p.color === 'w' ? v : -v;
          }
        }
      }
      return total;
    };

    // Minimax w/ αβ and killer‑move updates
    var minimax = function(depth, chessInstance, alpha, beta, isMaximisingPlayer) {
      if (depth === 0 || chessInstance.game_over()) {
        if (chessInstance.in_checkmate()) {
          return isMaximisingPlayer ? -Infinity : Infinity;
        }
        if (chessInstance.in_stalemate() || chessInstance.in_draw()) {
          return 0;
        }
        return evaluateBoard(chessInstance.board());
      }

      const moves = orderMoves(chessInstance.moves({ verbose: true }), depth);
      if (isMaximisingPlayer) {
        let best = -Infinity;
        for (let m of moves) {
          chessInstance.move(m);
          const score = minimax(depth - 1, chessInstance, alpha, beta, false);
          chessInstance.undo();

          if (score > best) best = score;
          alpha = Math.max(alpha, best);

          if (beta <= alpha) {
            if (!m.captured) {
              killerMoves[depth][1] = killerMoves[depth][0];
              killerMoves[depth][0] = m;
            }
            break;
          }
        }
        return best;
      } else {
        let best = Infinity;
        for (let m of moves) {
          chessInstance.move(m);
          const score = minimax(depth - 1, chessInstance, alpha, beta, true);
          chessInstance.undo();

          if (score < best) best = score;
          beta = Math.min(beta, best);

          if (beta <= alpha) {
            if (!m.captured) {
              killerMoves[depth][1] = killerMoves[depth][0];
              killerMoves[depth][0] = m;
            }
            break;
          }
        }
        return best;
      }
    };

    // Entry point
    var minimaxRoot = function(depth, fen, aiWorkerColor) {
      const chessInstance = new Chess(fen);
      const isWhite       = aiWorkerColor === 'white';
      const moves         = orderMoves(chessInstance.moves({ verbose: true }), depth);
      let bestValue       = isWhite ? -Infinity : Infinity;
      let bestMove        = null;

      for (let m of moves) {
        chessInstance.move(m);
        const val = minimax(depth - 1, chessInstance, -Infinity, Infinity, !isWhite);
        chessInstance.undo();

        if ((isWhite && val >= bestValue) || (!isWhite && val <= bestValue)) {
          bestValue = val;
          bestMove  = m;
        }
      }

      console.log('[Worker] Best move found:', bestMove?.san, 'eval:', bestValue);
      return bestMove
        ? { from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion }
        : null;
    };

    // --- Message handler with opening‑book check ---
    self.onmessage = function(event) {
      const { fen, depth, aiWorkerColor } = event.data;
      const key = normalizeFen(fen);

      const bookMoves = openingBook[key];
      if (bookMoves && bookMoves.length) {
        self.postMessage(shuffle(bookMoves.slice())[0]);
      } else {
        self.postMessage(minimaxRoot(depth, fen, aiWorkerColor));
      }
    };

    console.log('[Worker] AI Worker initialized with MVV/LVA + Killer Moves.');
