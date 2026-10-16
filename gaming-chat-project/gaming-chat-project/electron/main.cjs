const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
let serverProcess;
function createWindow(){
  const win = new BrowserWindow({width:1200,height:820,minWidth:360,minHeight:600,autoHideMenuBar:true,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  win.loadURL('http://127.0.0.1:3000');
  win.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('http'))shell.openExternal(url);return {action:'deny'};});
}
app.whenReady().then(()=>{
  const serverPath=path.join(__dirname,'..','server.js');
  serverProcess=spawn(process.execPath,[serverPath],{cwd:path.join(__dirname,'..'),env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PORT:'3000'},stdio:'inherit'});
  let tries=0;const timer=setInterval(()=>{tries++;if(tries>40){clearInterval(timer);createWindow();return;}require('node:http').get('http://127.0.0.1:3000/api/health',r=>{if(r.statusCode===200){clearInterval(timer);createWindow();}}).on('error',()=>{});},250);
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',()=>{if(serverProcess)serverProcess.kill();});
