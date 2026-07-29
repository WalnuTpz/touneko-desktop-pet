const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  getBootstrap: () => ipcRenderer.invoke("pet:get-bootstrap"),
  reportReady: () => ipcRenderer.send("pet:renderer-ready"),
  updateLayout: (rect) => ipcRenderer.send("pet:update-layout", rect),
  setPointerRegion: (overPet) =>
    ipcRenderer.send("pet:set-pointer-region", Boolean(overPet)),
  dragStart: (point) => ipcRenderer.send("pet:drag-start", point),
  dragMove: (point) => ipcRenderer.invoke("pet:drag-move", point),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  moveBy: (delta) => ipcRenderer.invoke("pet:move-by", delta),
  openMenu: () => ipcRenderer.send("pet:open-menu"),
  onCommand: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("pet:command", listener);
    return () => ipcRenderer.removeListener("pet:command", listener);
  },
});
