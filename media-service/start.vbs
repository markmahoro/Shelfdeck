Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)

' Start service (hidden window)
ws.Run "node src\server.js", 0, False

' Wait a moment for the server to start, then open admin page
WScript.Sleep 2000
ws.Run "http://127.0.0.1:18080/admin"
