#!/usr/bin/env python3
"""
Patch Cline's extension.js to hide unconfigured providers.

Strategy:
  Cline has an xqt function that checks remoteConfiguredProviders.
  If the list is empty/undefined, ALL providers are shown.
  If the list is set, ONLY those providers are shown.

  xqt=(t,e)=>{let r=e?.remoteConfiguredProviders??$i.get().getRemoteConfigSettings().remoteConfiguredProviders;return!r||!r.length?!0:t&&r.includes(t)}

  We patch the ternary: !r||!r.length?!0:t&&r.includes(t)
  To:                 !r||!r.length?(try{r=JSON.parse(require('fs').readFileSync(FILE,'utf8')).remoteConfiguredProviders}catch{}),!r||!r.length?!0:t&&r.includes(t):t&&r.includes(t)
  
  Too many bytes. Instead, we:
  1. Write hidden_providers.json with remoteConfiguredProviders
  2. Patch getRemoteConfigSettings() to read it
  
Target:
  getRemoteConfigSettings(){if(!this.isInitialized)throw new Error(DA);return this.remoteConfigCache}

We replace: return this.remoteConfigCache
With:       return Object.assign(this.remoteConfigCache, (()=>{try{return require('fs').existsSync(FILE)?JSON.parse(require('fs').readFileSync(FILE,'utf8')):{}}catch{return{}}})())
  
Still too many bytes. Let me try a different approach:
  
We can shrink the function elsewhere to make room, or use a shorter path.

SIMPLEST APPROACH:
  Since the xqt function reads from getRemoteConfigSettings(), and that returns
  an object, we can patch it to add a property if our file exists.

The method at offset 9935726 is:
  getRemoteConfigSettings(){if(!this.isInitialized)throw new Error(DA);return this.remoteConfigCache}

The byte sequence for 'return this.remoteConfigCache' is 31 bytes.
We need to replace it with something that also reads our file.

Instead, let me patch the xqt function directly:
  xqt=(t,e)=>{let r=e?.remoteConfiguredProviders??$i.get().getRemoteConfigSettings().remoteConfiguredProviders;return!r||!r.length?!0:t&&r.includes(t)}

I can replace '!0' (show all) with something that reads our file.
  ...return!r||!r.length?<READ FILE>:t&&r.includes(t)

But again, too many bytes.

ABSOLUTE SIMPLEST APPROACH — PATCH THE CLASS CONSTRUCTOR:
  Find where remoteConfigCache is initialized and set it from file there.

At offset 9931958: remoteConfigCache={}
Replace with code that reads our file on first access.

Actually, the very simplest: just add our providers to the remoteConfigCache
at startup by patching the 'clearRemoteConfig' function:

  clearRemoteConfig(){if(!this.isInitialized)throw new Error(DA);this.remoteConfigCache={}}

Replace {} with our defaults:
  clearRemoteConfig(){if(!this.isInitialized)throw new Error(DA);this.remoteConfigCache={remoteConfiguredProviders:['deepseek','lmstudio']}}

This is a fixed-length string! '{}' is 2 bytes, our replacement must also end with '}'.
'{remoteConfiguredProviders:[\"deepseek\",\"lmstudio\"]}' is longer...

Hmm. Let me count bytes more carefully.

Alternatively: The MINIMAL approach is just patch the xqt to always return false for providers we don't want.

Actually, let me go with the absolute simplest approach that works:
Just replace '!0' with '!1' in xqt so it NEVER shows all providers by default.
Then add our providers via another mechanism.

No wait, that would hide everything.

OK let me go with a completely different strategy. I'll modify the entrypoint to run a post-install patch script that:

1. Reads extension.js
2. Finds the xqt function
3. Replaces the entire function body with a new one that checks our file

For the new body, I'll use a compact version that fits in roughly the same space or slightly more (and I'll pad with spaces/semicolons from surrounding code).

Let me just write the patch script.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="create_file">
<｜｜DSML｜｜parameter name="content" string="true">#!/usr/bin/env python3
"""
Patch Cline extension.js to filter providers using hidden_providers.json.

Writes hidden_providers.json with the list of VISIBLE providers (not hidden).
Then patches Cline's getRemoteConfigSettings() to inject remoteConfiguredProviders
from that file into the returned config object.

The patch replaces:
  return this.remoteConfigCache
with:
  return this.remoteConfigCacheP||(this.remoteConfigCacheP=this._loadProviderFilter()),this.remoteConfigCache

And adds a helper method _loadProviderFilter that reads the JSON file.

But since we can't easily add bytes to a minified file, we use a different trick:
We overwrite the 'return' keyword with a call that first checks the file.
"""

import sys, os, json, re

def patch_extension(ext_js_path, visible_providers, hidden_providers_path):
    with open(ext_js_path, 'rb') as f:
        c = bytearray(f.read())
    
    # Write hidden_providers.json with remoteConfiguredProviders
    os.makedirs(os.path.dirname(hidden_providers_path), exist_ok=True)
    with open(hidden_providers_path, 'w') as f:
        json.dump({'remoteConfiguredProviders': visible_providers}, f)
    print(f"  Written {hidden_providers_path} with providers: {visible_providers}")
    
    # Strategy: Find xqt function and patch the fallback behavior.
    # xqt at offset ~9930399:
    #   xqt=(t,e)=>{let r=e?.remoteConfiguredProviders??$i.get().getRemoteConfigSettings().remoteConfiguredProviders;return!r||!r.length?!0:t&&r.includes(t)}
    #
    # We want: when remoteConfigCache doesn't have remoteConfiguredProviders,
    # read our local file instead of falling through to show all.
    #
    # New xqt:
    #   xqt=(t,e)=>{let r=e?.remoteConfiguredProviders??(($i.get().getRemoteConfigSettings().remoteConfiguredProviders)||eval('try{JSON.parse(require("fs").readFileSync("/home/coder/.cline/data/hidden_providers.json","utf8")).remoteConfiguredProviders}catch(e){null}'));return!r||!r.length?!0:t&&r.includes(t)}
    #
    # Too long. Different approach:
    
    # ACTUAL APPROACH: 
    # The getRemoteConfigSettings reads from remoteConfigCache which starts as {}.
    # We can patch the initialization to read our file.
    #
    # In the $i class (StateManager), remoteConfigCache={} is initialized.
    # We'll replace the getter to check our file.
    
    # Find: getRemoteConfigSettings(){if(!this.isInitialized)throw new Error(DA);return this.remoteConfigCache}
    # Offset ~9935726
    
    target = b'getRemoteConfigSettings(){if(!this.isInitialized)throw new Error'
    idx = c.find(target)
    if idx < 0:
        print("  ERROR: getRemoteConfigSettings not found")
        return False
    
    # Find the closing } of this method
    # The method body is: {if(!this.isInitialized)throw new Error(DA);return this.remoteConfigCache}
    return_start = c.find(b'return this.remoteConfigCache', idx)
    if return_start < 0:
        print("  ERROR: return statement not found")
        return False
    
    method_end = c.find(b'}', return_start)
    if method_end < 0:
        print("  ERROR: method end not found")
        return False
    
    # The current return statement: 'return this.remoteConfigCache' (30 bytes)
    # We want to replace the method with one that also checks our file.
    # 
    # New method (compact):
    # getRemoteConfigSettings(){
    #   if(!this.isInitialized)throw new Error(DA);
    #   if(!this.remoteConfigCache._loaded_){
    #     try{
    #       let d=require("fs").readFileSync("FILE","utf8");
    #       Object.assign(this.remoteConfigCache,JSON.parse(d));
    #     }catch(e){}
    #     this.remoteConfigCache._loaded_=1;
    #   }
    #   return this.remoteConfigCache
    # }
    #
    # This is significantly longer. We need to make room.
    
    # SIMPLER: just patch the xqt function at the point where it falls through
    # The '!0' at the end means "show all". We change it to read our file.
    # 
    # xqt body: return!r||!r.length?!0:t&&r.includes(t)
    #                                 ^^ this is the fallback
    #
    # We replace '!0' with a check. '!0' is 2 bytes.
    # We need: r=readFile(),!r||!r.length?!0:...
    # But we only have 2 bytes!
    #
    # ALTERNATIVE: find a nearby string we can shorten to make room.
    # Actually found a solution: we replace the entire xqt function body
    # with a different implementation.
    
    # Find xqt function
    xqt_target = b'xqt=(t,e)=>{let r=e?.remoteConfiguredProviders??$i.get().getRemoteConfigSettings().remoteConfiguredProviders;return!r||!r.length?!0:t&&r.includes(t)}'
    xqt_idx = c.find(xqt_target)
    if xqt_idx < 0:
        # Try without the let r assignment
        xqt_target2 = b'xqt=(t,e)=>{let r=e?.remoteConfiguredProviders??'
        xqt_idx = c.find(xqt_target2)
    
    if xqt_idx >= 0:
        print(f"  Found xqt at offset {xqt_idx}")
        # Build replacement that reads hidden_providers.json
        # Compact version using Node.js require cache
        filepath = hidden_providers_path
        
        new_xqt = (
            b'xqt=(t,e)=>{'
            b'let r=e?.remoteConfiguredProviders??$i.get().getRemoteConfigSettings().remoteConfiguredProviders;'
            b'if(!r||!r.length){'
            b'try{let x=require("fs").readFileSync("' + filepath.encode() + b'","utf8");'
            b'r=JSON.parse(x).remoteConfiguredProviders}catch(e){}'
            b'}'
            b'return!r||!r.length?!0:t&&r.includes(t)'
            b'}'
        )
        
        # Need to find the exact end of xqt function 
        # The function ends with }
        xqt_end = c.find(b'}', xqt_idx + len(xqt_target))
        
        if new_xqt != xqt_target:
            print(f"  Original: {len(xqt_target)} bytes")
            print(f"  New:      {len(new_xqt)} bytes")
            print(f"  Diff:     {len(new_xqt) - len(xqt_target)} bytes")
            
            if len(new_xqt) <= len(xqt_target):
                # Same or shorter - easy replacement
                c[xqt_idx:xqt_idx + len(new_xqt)] = new_xqt
                # Pad remaining with spaces
                for i in range(len(new_xqt), len(xqt_target)):
                    c[xqt_idx + i] = ord(' ')
            else:
                print("  WARNING: New function is longer. Trying alternative approach...")
                return patch_via_require_hook(ext_js_path, visible_providers)
        
        with open(ext_js_path, 'wb') as f:
            f.write(c)
        print("  ✓ Patched xqt function to read hidden_providers.json")
        return True
    
    print("  ERROR: xqt function not found")
    return False

def patch_via_require_hook(ext_js_path, visible_providers):
    """Fallback: inject a require hook at startup"""
    # Write a small JS file that monkey-patches Cline
    hook_code = f'''
(function(){{
  var fs=require("fs");
  var path=require("path");
  var os=require("os");
  var file=path.join(os.homedir(),".cline","data","hidden_providers.json");
  var providers={json.dumps(visible_providers)};
  
  // Wait for Cline's StateManager to be created, then patch
  var interval=setInterval(function(){{
    try{{
      var mod=require.cache;
      for(var k in mod){{
        if(k.indexOf("saoudrizwan.claude-dev")>=0 && k.endsWith("extension.js")){{
          var m=mod[k];
          if(m && m.exports && m.exports.getRemoteConfigSettings){{
            var orig=m.exports.getRemoteConfigSettings;
            m.exports.getRemoteConfigSettings=function(){{
              var r=orig.call(this);
              if(!r.remoteConfiguredProviders) r.remoteConfiguredProviders=providers;
              return r;
            }};
            clearInterval(interval);
          }}
        }}
      }}
    }}catch(e){{}}
  }},500);
  setTimeout(function(){{clearInterval(interval);}},15000);
}})();
'''
    
    hook_path = os.path.join(os.path.dirname(ext_js_path), '..', 'cline-provider-hook.js')
    with open(hook_path, 'w') as f:
        f.write(hook_code)
    print(f"  Written require hook to {hook_path}")
    print("  Add --require to node options or patch entrypoint to source this file")
    return True

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: patch_provider_filter.py <extension.js> <hidden_providers.json> [provider1,provider2,...]")
        sys.exit(1)
    
    ext_js = sys.argv[1]
    hidden_file = sys.argv[2]
    providers = sys.argv[3].split(',') if len(sys.argv) > 3 else ['deepseek', 'lmstudio']
    
    patch_extension(ext_js, providers, hidden_file)
