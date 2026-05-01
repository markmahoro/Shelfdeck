Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

' Script root = ShelfDeck-v1.0.0/
ws.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)

' Start service from media-service/ subfolder (hidden window)
ws.Run "media-service\node.exe media-service\src\server.js", 0, False

' Wait for server to start, then open admin page
WScript.Sleep 2000
ws.Run "http://127.0.0.1:18080/admin"
