#!/usr/bin/env node
'use strict';
// Per-user provider filter for Cline extension.
// Reads hidden_providers.json on every access so that auth/update can
// change the visible provider list at runtime without an extension host restart.
var fs=require('fs'),path=require('path'),os=require('os');
var HP=path.join(os.homedir(),'.cline','data','hidden_providers.json');
Object.defineProperty(globalThis,'__aurora_providers',{
  get:function(){
    try{
      if(fs.existsSync(HP)){
        var d=JSON.parse(fs.readFileSync(HP,'utf8'));
        if(d.remoteConfiguredProviders&&d.remoteConfiguredProviders.length)
          return d.remoteConfiguredProviders;
      }
    }catch(e){}
    return [];  // fail-closed: no providers unless explicitly configured
  },
  enumerable:true,
  configurable:true
});
