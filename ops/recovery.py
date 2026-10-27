#!/usr/bin/env python3
"""Consistent encrypted backups. Restore requires stopped writers and explicit flags."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tarfile, tempfile
os.umask(0o077)
def command(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)
def compose(*args, **kwargs):
    return command(["docker", "compose", *args], **kwargs)
def running():
    data=compose("ps","--status","running","--services",capture_output=True,text=True).stdout.split()
    return [name for name in ("api","worker") if name in data]
def digest(path):
    with open(path,"rb") as f:return hashlib.file_digest(f,"sha256").hexdigest()
def validate_archive(path):
    # Extraction is never delegated to tar: refuse links, traversal and unexpected files.
    with tarfile.open(path,"r:gz") as archive:
        members=archive.getmembers()
        if len(members)>100000:raise ValueError("Too many artifacts")
        for m in members:
            parts=pathlib.PurePosixPath(m.name).parts
            if m.issym() or m.islnk() or not (m.isfile() or m.isdir()) or ".." in parts or m.name.startswith("/") or m.size>20_000_000:
                raise ValueError("Unsafe artifact archive")
        if sum(m.size for m in members)>20_000_000_000:raise ValueError("Artifact archive exceeds restore budget")
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="action",required=True)
    backup=sub.add_parser("backup");backup.add_argument("--recipient",required=True);backup.add_argument("--output",required=True)
    restore=sub.add_parser("restore");restore.add_argument("--identity",required=True);restore.add_argument("--input",required=True);restore.add_argument("--apply",action="store_true");restore.add_argument("--maintenance-confirmed",action="store_true")
    args=parser.parse_args()
    for tool in ("docker","age"):
        if not shutil.which(tool):raise RuntimeError(tool+" is required")
    with tempfile.TemporaryDirectory(prefix="launchcheck-recovery-") as temp:
        root=pathlib.Path(temp)
        if args.action=="backup":
            output=pathlib.Path(args.output).resolve()
            if output.exists():raise ValueError("Refusing to overwrite backup")
            output.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            writers=running()
            try:
                if writers:compose("stop",*writers,stdout=subprocess.DEVNULL)
                with open(root/"db.archive.gz","wb") as stream:compose("exec","-T","mongo","mongodump","--config=/run/launchcheck/mongo_backup_config","--db=launchcheck","--archive","--gzip",stdout=stream)
                with open(root/"artifacts.tar.gz","wb") as stream:compose("run","--rm","--no-deps","-T","backup-files","-czf","-","-C","/data/artifacts",".",stdout=stream)
                manifest={"version":1,"files":{n:digest(root/n) for n in ("db.archive.gz","artifacts.tar.gz")}}
                (root/"manifest.json").write_text(json.dumps(manifest))
                bundle=root/"bundle.tar"
                with tarfile.open(bundle,"w") as archive:
                    for n in (*manifest["files"],"manifest.json"):archive.add(root/n,arcname=n)
                command(["age","--recipient",args.recipient,"--output",str(output),str(bundle)])
                output.chmod(0o600)
            finally:
                if writers:compose("start",*writers,stdout=subprocess.DEVNULL)
            print("Encrypted backup created; store it off-host and test restoration.")
        else:
            bundle=root/"bundle.tar"
            command(["age","--decrypt","--identity",args.identity,"--output",str(bundle),args.input])
            with tarfile.open(bundle,"r:") as archive:
                members=archive.getmembers()
                if sorted(m.name for m in members)!=["artifacts.tar.gz","db.archive.gz","manifest.json"] or any(not m.isfile() or m.size>20_000_000_000 for m in members):raise ValueError("Invalid backup bundle")
                for m in members:
                    with archive.extractfile(m) as source,open(root/m.name,"wb") as target:shutil.copyfileobj(source,target)
            manifest=json.loads((root/"manifest.json").read_text())
            if manifest.get("version")!=1 or set(manifest.get("files",{}))!={"db.archive.gz","artifacts.tar.gz"}:raise ValueError("Invalid manifest")
            for n,expected in manifest["files"].items():
                if digest(root/n)!=expected:raise ValueError("Backup checksum mismatch")
            validate_archive(root/"artifacts.tar.gz")
            if not args.apply:
                print("Decryption, manifest, checksums and artifact safety verified. No data changed.");return
            if not args.maintenance_confirmed or running():raise ValueError("Stop api/worker and pass --maintenance-confirmed before applying a restore")
            # Drop replaces only the launchcheck database, never other databases.
            with open(root/"db.archive.gz","rb") as stream:compose("exec","-T","mongo","mongorestore","--config=/run/launchcheck/mongo_backup_config","--nsInclude=launchcheck.*","--archive","--gzip","--drop",stdin=stream)
            # Existing artifacts are not removed automatically. Use a fresh isolated project for drills.
            with open(root/"artifacts.tar.gz","rb") as stream:compose("run","--rm","--no-deps","-T","backup-files","-xzf","-","--no-same-owner","-C","/data/artifacts",stdin=stream)
            print("Restore applied. Writers remain stopped. Reconcile retained/deleted reports before reopening access.")
if __name__=="__main__":main()
