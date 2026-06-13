#!/usr/bin/env node
'use strict';
var fs=require('fs'),path=require('path'),os=require('os');
var HP=path.join(os.homedir(),'.cline','data','hidden_providers.json');
try{
  if(fs.existsSync(HP)){
    var d=JSON.parse(fs.readFileSync(HP,'utf8'));
    if(d.remoteConfiguredProviders&&d.remoteConfiguredProviders.length)
      globalThis.__aurora_providers=d.remoteConfiguredProviders;
  }
}catch(e){}
if(!globalThis.__aurora_providers||!globalThis.__aurora_providers.length)
  globalThis.__aurora_providers=["deepseek","lmstudio","ollama"];
