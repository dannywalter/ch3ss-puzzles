/**
 * Stockfish Chess Engine Integration for CH3SS
 * 
 * This file contains the code needed to integrate the Stockfish WASM chess engine
 * into the CH3SS game. The integration uses a Web Worker to run Stockfish in a separate
 * thread, preserving UI responsiveness.
 * 
 * Currently configured to work in the background while the difficulty selector
 * remains disabled with "COMING SOON".
 */

// Stockfish engine variables
let stockfish = null;
let stockfishReady = false;
let stockfishLoaded = false;

/**
 * Initializes the Stockfish chess engine in the background
 * This loads the engine but doesn't activate it in the UI yet
 */
function initStockfishInBackground() {
  try {
    console.log("Initializing Stockfish in background (for future use)");
    
    // Check if Stockfish is already loaded
    if (stockfishLoaded) {
      console.log("Stockfish already loaded");
      return;
    }
    
    // Load Stockfish script asynchronously
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/stockfish.wasm@0.10.0/stockfish.js';
    script.async = true;
    
    script.onload = function() {
      console.log("Stockfish script loaded successfully");
      stockfishLoaded = true;
      
      // Initialize the worker but don't use it yet (waiting for difficulty settings)
      initStockfishWorker();
    };
    
    script.onerror = function() {
      console.error("Failed to load Stockfish script");
    };
    
    document.head.appendChild(script);
  } catch (err) {
    console.error("Error initializing Stockfish:", err);
  }
}

/**
 * Initialize the Stockfish Web Worker using Blob URL approach to avoid CORS issues
 * This creates the worker but doesn't integrate it with the game yet
 */
function initStockfishWorker() {
  try {
    console.log("Initializing Stockfish worker with Blob URL");
    
    // Create proxy code that imports the Stockfish worker script
    const workerCode = `
      // Import the Stockfish worker script
      importScripts('https://cdn.jsdelivr.net/npm/stockfish.wasm@0.10.0/stockfish.worker.js');
    `;
    
    // Create a blob with the worker code
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const blobURL = URL.createObjectURL(blob);
    
    // Create worker from blob URL (this avoids CORS issues)
    stockfish = new Worker(blobURL);
    
    // Set up message handler for stockfish responses
    stockfish.addEventListener('message', (e) => {
      const line = e.data;
      
      // Log all stockfish output for debugging
      console.log('Stockfish:', line);
      
      // Check if engine is ready
      if (line === 'readyok') {
        stockfishReady = true;
        console.log('Stockfish engine ready');
      }
      
      // Parse "bestmove" responses when Stockfish suggests a move
      if (line.startsWith('bestmove')) {
        const moveRegex = /bestmove\s+(\w+)/;
        const match = moveRegex.exec(line);
        if (match) {
          const bestMove = match[1];
          // We're not using the moves yet, just logging them
          console.log('Stockfish suggests move:', bestMove);
        }
      }
    });
    
    // Initialize the engine
    stockfish.postMessage('uci');
    stockfish.postMessage('isready');
    
    // Set UCI options for Stockfish (can be adjusted)
    stockfish.postMessage('setoption name Skill Level value 10'); // Range 0-20 
    stockfish.postMessage('setoption name Threads value 2'); // Use 2 threads
    
    console.log("Stockfish worker initialized and waiting for future use");
  } catch (err) {
    console.error("Error initializing Stockfish worker:", err);
    stockfish = null;
  }
}

/**
 * Function to request a move from Stockfish
 * This is ready to use when difficulty levels are enabled
 * 
 * @param {string} fen - The current position in FEN notation
 * @param {string} difficulty - The difficulty level (easy, medium, hard, expert)
 * @param {function} callback - Function to call with the best move
 */
function requestStockfishMove(fen, difficulty, callback) {
  if (!stockfish || !stockfishReady) {
    console.error('Stockfish not ready');
    return false; // Return false to indicate Stockfish isn't ready
  }
  
  // Adjust skill level based on difficulty
  let skillLevel = 10;
  let moveTime = 1000;
  
  switch (difficulty) {
    case "easy":
      skillLevel = 5;
      moveTime = 500;
      break;
    case "medium":
      skillLevel = 10;
      moveTime = 1000;
      break;
    case "hard": 
      skillLevel = 15;
      moveTime = 1500;
      break;
    case "expert":
      skillLevel = 20;
      moveTime = 2000;
      break;
  }
  
  // Set skill level
  stockfish.postMessage(`setoption name Skill Level value ${skillLevel}`);
  
  // Handle incoming messages for this specific request
  const messageHandler = (e) => {
    const line = e.data;
    
    if (line.startsWith('bestmove')) {
      const moveRegex = /bestmove\s+(\w+)/;
      const match = moveRegex.exec(line);
      if (match) {
        const bestMove = match[1];
        // Remove the event listener once we've got our move
        stockfish.removeEventListener('message', messageHandler);
        callback(bestMove);
      }
    }
  };
  
  // Add temporary event listener for this move request
  stockfish.addEventListener('message', messageHandler);
  
  // Send the position and request a move
  stockfish.postMessage(`position fen ${fen}`);
  stockfish.postMessage(`go movetime ${moveTime}`);
  
  return true; // Return true to indicate Stockfish is processing the request
}

/**
 * Execute a move recommended by Stockfish
 * Convert UCI format to chess.js move format
 * 
 * @param {string} moveString - UCI format move (e.g., "e2e4")
 * @param {object} chessInstance - The chess.js instance
 * @returns {object} The move result from chess.js
 */
function makeStockfishMove(moveString, chessInstance) {
  // Convert UCI move format (e.g., "e2e4") to chess.js format
  const from = moveString.substring(0, 2);
  const to = moveString.substring(2, 4);
  const promotion = moveString.length > 4 ? moveString[4] : undefined;
  
  // Make the move
  const moveResult = chessInstance.move({
    from: from,
    to: to,
    promotion: promotion
  });
  
  return moveResult;
}

// Initialize Stockfish after the page is fully loaded
window.addEventListener('load', function() {
  // Wait a bit before loading Stockfish to prioritize game UI
  setTimeout(initStockfishInBackground, 5000);
});

// Export functions for use in the main game
window.CH3SS = window.CH3SS || {};
window.CH3SS.stockfish = {
  isReady: () => stockfishReady,
  requestMove: requestStockfishMove,
  makeMove: makeStockfishMove
};