const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  getSettings: () => ipcRenderer.invoke("pet:get-settings"),
  dragStart: (point) => ipcRenderer.send("pet:drag-start", point),
  dragMove: (point) => ipcRenderer.send("pet:drag-move", point),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  moveBy: (delta) => ipcRenderer.invoke("pet:move-by", delta),
  openMenu: () => ipcRenderer.send("pet:open-menu"),
  onCommand: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("pet:command", listener);
    return () => ipcRenderer.removeListener("pet:command", listener);
  },
});
