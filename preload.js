'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  aiChat: (opts) => ipcRenderer.invoke('ai:chat', opts),
  aiTts: (opts) => ipcRenderer.invoke('ai:tts', opts),
  edgeTts: (opts) => ipcRenderer.invoke('edge:tts', opts),
  edgeVoices: (force) => ipcRenderer.invoke('edge:voices', force),
  dictLookup: (word) => ipcRenderer.invoke('dict:lookup', word),
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (json) => ipcRenderer.invoke('data:save', json),
  exportFile: (opts) => ipcRenderer.invoke('file:export', opts),
  importFile: (opts) => ipcRenderer.invoke('file:import', opts),
  appInfo: () => ipcRenderer.invoke('app:info')
});
