const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const Store = require('electron-store');
const robot = require('robotjs');
const { GlobalKeyboardListener } = require('node-global-key-listener');

const store = new Store();
let mainWindow;
let tray;
let keyListener;
let isAppQuitting = false;

// Auto-clicker variables
let autoClickerInterval;
let macroRecording = [];
let macroPlaying = false;
let hotkeyPressed = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false,
    title: 'PC Automation Suite'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window close - minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!isAppQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Development tools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, '../assets/tray-icon.png'));
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'Quit',
      click: () => {
        isAppQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('PC Automation Suite');
  tray.setContextMenu(contextMenu);
  
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function setupGlobalKeyListener() {
  keyListener = new GlobalKeyboardListener();
  
  keyListener.addListener((e, down) => {
    if (e.state === 'DOWN') {
      const settings = store.get('settings', {});
      
      // Auto-clicker hotkey
      if (e.name === (settings.autoClickerHotkey || 'F1')) {
        toggleAutoClicker();
      }
      
      // Macro record hotkey
      if (e.name === (settings.macroRecordHotkey || 'F2')) {
        toggleMacroRecording();
      }
      
      // Macro playback hotkey
      if (e.name === (settings.macroPlaybackHotkey || 'F3')) {
        playMacro();
      }
      
      // Hotkey clicker
      if (e.name === (settings.hotkeyButton || 'F')) {
        if (settings.hotkeyMode === 'hold') {
          robot.keyToggle(settings.hotkeyButton.toLowerCase(), 'down');
        } else if (settings.hotkeyMode === 'toggle') {
          hotkeyPressed = !hotkeyPressed;
          if (hotkeyPressed) {
            robot.keyToggle(settings.hotkeyButton.toLowerCase(), 'down');
          } else {
            robot.keyToggle(settings.hotkeyButton.toLowerCase(), 'up');
          }
        }
      }
    } else if (e.state === 'UP') {
      const settings = store.get('settings', {});
      
      // Release hotkey if in hold mode
      if (e.name === (settings.hotkeyButton || 'F') && settings.hotkeyMode === 'hold') {
        robot.keyToggle(settings.hotkeyButton.toLowerCase(), 'up');
      }
    }
  });
}

// IPC Handlers
ipcMain.handle('get-settings', () => {
  return store.get('settings', {
    autoClickerSpeed: 100,
    autoClickerHotkey: 'F1',
    macroRecordHotkey: 'F2',
    macroPlaybackHotkey: 'F3',
    macroSpeed: 1,
    hotkeyButton: 'F',
    hotkeyMode: 'toggle'
  });
});

ipcMain.handle('save-settings', (event, settings) => {
  store.set('settings', settings);
  return true;
});

ipcMain.handle('start-auto-clicker', (event, speed) => {
  stopAutoClicker();
  autoClickerInterval = setInterval(() => {
    const mousePos = robot.getMousePos();
    robot.mouseClick('left');
  }, speed);
  return true;
});

ipcMain.handle('stop-auto-clicker', () => {
  stopAutoClicker();
  return true;
});

ipcMain.handle('start-macro-recording', () => {
  macroRecording = [];
  // Note: Actual macro recording would need more sophisticated event capture
  return true;
});

ipcMain.handle('stop-macro-recording', () => {
  store.set('lastMacro', macroRecording);
  return macroRecording;
});

ipcMain.handle('play-macro', (event, macro, speed, times) => {
  if (macroPlaying) return false;
  
  macroPlaying = true;
  let playCount = 0;
  const maxPlays = times === -1 ? Infinity : times;
  
  const playMacroOnce = () => {
    if (playCount >= maxPlays || !macroPlaying) {
      macroPlaying = false;
      return;
    }
    
    // Play macro actions with speed multiplier
    macro.forEach((action, index) => {
      setTimeout(() => {
        if (action.type === 'click') {
          robot.moveMouse(action.x, action.y);
          robot.mouseClick(action.button || 'left');
        } else if (action.type === 'key') {
          robot.keyTap(action.key);
        }
      }, index * (100 / speed));
    });
    
    playCount++;
    setTimeout(playMacroOnce, macro.length * (100 / speed) + 100);
  };
  
  playMacroOnce();
  return true;
});

ipcMain.handle('stop-macro', () => {
  macroPlaying = false;
  return true;
});

// Helper functions
function toggleAutoClicker() {
  if (autoClickerInterval) {
    stopAutoClicker();
    mainWindow.webContents.send('auto-clicker-stopped');
  } else {
    const settings = store.get('settings', {});
    autoClickerInterval = setInterval(() => {
      robot.mouseClick('left');
    }, settings.autoClickerSpeed || 100);
    mainWindow.webContents.send('auto-clicker-started');
  }
}

function stopAutoClicker() {
  if (autoClickerInterval) {
    clearInterval(autoClickerInterval);
    autoClickerInterval = null;
  }
}

function toggleMacroRecording() {
  // Implementation for macro recording toggle
  mainWindow.webContents.send('macro-recording-toggled');
}

function playMacro() {
  const lastMacro = store.get('lastMacro', []);
  if (lastMacro.length > 0) {
    const settings = store.get('settings', {});
    mainWindow.webContents.send('macro-played', lastMacro, settings.macroSpeed);
  }
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
  createTray();
  setupGlobalKeyListener();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // Keep app running in tray
});

app.on('before-quit', () => {
  isAppQuitting = true;
  stopAutoClicker();
  if (keyListener) {
    keyListener.kill();
  }
});