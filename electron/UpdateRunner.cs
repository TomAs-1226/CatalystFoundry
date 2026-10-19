using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

[DataContract] public sealed class UpdateReport {
 [DataMember(EmitDefaultValue=false)] public bool ready;
 [DataMember(EmitDefaultValue=false)] public int processId;
 [DataMember(EmitDefaultValue=false)] public bool passed;
 [DataMember(EmitDefaultValue=false)] public int? installerExitCode;
 [DataMember(EmitDefaultValue=false)] public string sha256;
 [DataMember(EmitDefaultValue=false)] public string verifiedAt;
 [DataMember(EmitDefaultValue=false)] public string error;
 [DataMember(EmitDefaultValue=false)] public bool probeOnly;
}
public static class UpdateRunner {
 static string Env(string key) { return Environment.GetEnvironmentVariable("CATALYST_UPDATE_"+key); }
 static string Digest(string file) { using(var stream=File.OpenRead(file))using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant(); }
 static void Write(string file,UpdateReport report) {
  string temporary=file+".tmp-"+Guid.NewGuid().ToString("N");
  using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None))new DataContractJsonSerializer(typeof(UpdateReport)).WriteObject(stream,report);
  if(File.Exists(file))File.Replace(temporary,file,null);else File.Move(temporary,file);
 }
 [STAThread] public static int Main() {
  string result=Env("RESULT");
  try {
   string installer=Env("INSTALLER"),application=Env("APPLICATION"),ready=Env("READY"),sha=Env("SHA256");
   foreach(string file in new[]{installer,application,ready,result})if(String.IsNullOrEmpty(file)||!Path.IsPathRooted(file))throw new Exception("Update helper requires absolute paths.");
   if(sha==null||!Regex.IsMatch(sha,"^[a-f0-9]{64}$")||Digest(installer)!=sha)throw new Exception("Update bytes changed before restart.");
   int parentId;if(!Int32.TryParse(Env("PARENT"),out parentId)||parentId<=0)throw new Exception("Invalid update parent.");
   Process parent=null;try{parent=Process.GetProcessById(parentId);}catch(ArgumentException){}
   Write(ready,new UpdateReport{ready=true,processId=Process.GetCurrentProcess().Id,sha256=sha});
   if(parent!=null){using(parent){if(!parent.WaitForExit(90000))throw new Exception("Foundry did not close; update was not installed.");}}
   if(Digest(installer)!=sha)throw new Exception("Update bytes changed before installation.");
   // Native lifecycle regression tests never execute an installer or launch an app.
   if(Env("PROBE_ONLY")=="1"){Write(result,new UpdateReport{passed=true,probeOnly=true,sha256=sha,verifiedAt=DateTime.UtcNow.ToString("o")});return 0;}
   using(var installed=Process.Start(new ProcessStartInfo(installer,"/S"){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden})){
    installed.WaitForExit();if(installed.ExitCode!=0)throw new Exception("Update installer failed: "+installed.ExitCode);
   }
   if(!File.Exists(application))throw new Exception("Installed application was not found.");
   Write(result,new UpdateReport{passed=true,installerExitCode=0,sha256=sha,verifiedAt=DateTime.UtcNow.ToString("o")});
   Process.Start(new ProcessStartInfo(application){UseShellExecute=true});return 0;
  }catch(Exception error){
   try{if(!String.IsNullOrEmpty(result)&&Path.IsPathRooted(result))Write(result,new UpdateReport{error=error.Message,verifiedAt=DateTime.UtcNow.ToString("o")});}catch{}
   return 1;
  }
 }
}
