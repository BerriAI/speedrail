import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { replayGitEnvironment, replaySandboxProfile } from '../scripts/litellm-harness/isolation.js';

it.skipIf(process.platform!=='darwin')('blocks live source and reference data, including symlinks and subprocesses',()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'litellm-isolation-')));
  try{
    const dirs={home:join(root,'users/me'),campaignRoot:join(root,'campaign'),sourceRepo:join(root,'source'),runtimeRoot:join(root,'runtime'),pythonEnvironment:join(root,'source/.venv'),nodeRoot:join(root,'node'),runDirectory:join(root,'campaign/runs/one')};
    for(const dir of Object.values(dirs))mkdirSync(dir,{recursive:true});
    const outside=join(dirs.sourceRepo,'future.py'),answer=join(dirs.campaignRoot,'reference.patch'),inside=join(dirs.runDirectory,'source.py'),dependency=join(dirs.pythonEnvironment,'dependency'),sharedTemp=join(root,'other-run-probe.py');
    for(const file of [outside,answer,inside,dependency,sharedTemp])writeFileSync(file,'fixture');
    symlinkSync(outside,join(dirs.runDirectory,'link.py'));
    const manifest=join(dirs.runDirectory,'task.json'),sourceRecord=join(dirs.runDirectory,'harness-source.json');
    writeFileSync(manifest,'hidden selection');writeFileSync(sourceRecord,'frozen source');
    const git=execFileSync('/usr/bin/xcrun',['--find','git'],{encoding:'utf8'}).trim();
    const gitEnv={...process.env,...replayGitEnvironment(),TMPDIR:dirs.runDirectory};
    execFileSync(git,['init','-q'],{cwd:dirs.runDirectory,env:gitEnv});
    const profile=join(root,'profile.sb');writeFileSync(profile,replaySandboxProfile(dirs));
    for(const file of [outside,answer,sharedTemp,manifest,join(dirs.runDirectory,'link.py')]){
      expect(spawnSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/cat',file],{encoding:'utf8'}).status).not.toBe(0);
      expect(spawnSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/sh','-c','cat "$1"','shell',file],{encoding:'utf8'}).status).not.toBe(0);
    }
    // A normal diff/status must work without granting access to global Git config.
    const status=spawnSync('/usr/bin/sandbox-exec',['-f',profile,git,'-C',dirs.runDirectory,'status','--short'],{env:gitEnv,encoding:'utf8'});
    expect(status.status).toBe(0);expect(status.stderr).toBe('');
    for(const file of [inside,dependency])expect(execFileSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/cat',file],{encoding:'utf8'})).toBe('fixture');
    expect(spawnSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/sh','-c','echo changed > "$1"','shell',outside]).status).not.toBe(0);
    expect(spawnSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/sh','-c','echo changed > "$1"','shell',inside]).status).toBe(0);
    expect(spawnSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/sh','-c','echo changed > "$1"','shell',sourceRecord]).status).not.toBe(0);
    const temporary=execFileSync('/usr/bin/sandbox-exec',['-f',profile,'/usr/bin/mktemp',join(dirs.runDirectory,'probe.XXXXXXXX')],{encoding:'utf8'}).trim();
    expect(temporary.startsWith(dirs.runDirectory+'/')).toBe(true);
  }finally{rmSync(root,{recursive:true,force:true});}
});
