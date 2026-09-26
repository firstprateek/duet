# Setting up the Mac mini

Duet runs on our two Macs. A Mac mini at home relays encrypted changes between them (and, from
M4, runs the local models that help with sorting). It only ever stores ciphertext: whoever holds
a recovery phrase can open the data, and nobody else can, including the Mac mini itself.

| Service | How it runs | Reachable at |
| --- | --- | --- |
| Tailscale | The open-source `tailscaled` daemon, so it runs with nobody logged in | — |
| Duet relay | `duet-sync`, one binary, a LaunchDaemon that restarts it if it stops | 127.0.0.1:8787, published over HTTPS by `tailscale serve` |
| Nightly backup | `duet-sync backup`, a LaunchDaemon at 03:15 | `/usr/local/var/duet/backups` |
| The app | A copy of the latest release, made by `duet-server update` | `/app` on the same address, for our Macs to install and update from |

The repository is private, so our Macs never download anything from GitHub: the Mac mini copies
each release and hands it to them over Tailscale.

## 1. Tailscale

Install the daemon rather than the App Store app, so it works before anyone logs in:

```bash
brew install tailscale
sudo brew services start tailscale
sudo tailscale up --operator=$USER
```

`--operator` lets `duet-server` publish the relay and the app without asking for a password each
time. The Tailscale app works too if the Mac mini logs in by itself after a restart (automatic
login on, FileVault off).

Then, in the admin console's **Machines** list, open the Mac mini's **⋯** menu and choose **Disable
key expiry**. Otherwise its login lapses after a few months and it drops off the tailnet quietly.

In the Tailscale admin console, let only our two Macs reach the Mac mini, and only on 443. With
the Mac mini tagged `tag:duet`, the policy's rule looks like this (use our real login names):

```json
{
  "tagOwners": { "tag:duet": ["autogroup:admin"] },
  "acls": [
    { "action": "accept", "src": ["jack@example.com", "jill@example.com"], "dst": ["tag:duet:443"] }
  ]
}
```

Device tokens are a second lock: a Mac that isn't paired can't read or write anything.

## 2. GitHub

The Mac mini signs in to GitHub once, to copy each release from our private repository. A token
that can only read this one repository is enough: on GitHub, **Settings → Developer settings →
Fine-grained tokens**, with access to `firstprateek/duet` only and **Contents: Read-only**. Then:

```bash
brew install gh
gh auth login --with-token     # paste the token
gh auth setup-git              # so git can use it too
gh repo clone firstprateek/duet ~/duet
cd ~/duet
```

The commands below run from that copy. `git pull` brings it up to date.

## 3. Keep it awake

```bash
services/sync/deploy/duet-server keep-awake
```

It never sleeps, and starts again after a power cut.

## 4. The relay

Take it from the latest release, or build it on one of our Macs (it needs [Bun](https://bun.sh))
and copy it over:

```bash
gh release download --repo firstprateek/duet --pattern duet-sync-darwin-arm64 --dir /tmp
services/sync/deploy/duet-server install /tmp/duet-sync-darwin-arm64

# or, on a Mac with the repository and Bun:
pnpm --filter @duet/sync build
scp services/sync/bin/duet-sync mac-mini:/tmp/
# then, on the Mac mini:
services/sync/deploy/duet-server install /tmp/duet-sync
```

`install` puts the binary in `/usr/local/bin`, the database in `/usr/local/var/duet`, starts it
under launchd, and publishes it on the tailnet. It prints the address to use, something like
`https://mac-mini.tail1234.ts.net`. Check on it any time with `duet-server status`.

## 5. Duet on our Macs

Once there's a release, copy it to the Mac mini:

```bash
services/sync/deploy/duet-server update
```

It prints the line that installs Duet on each Mac, something like:

```bash
curl -fsSL https://mac-mini.tail1234.ts.net/app/install.sh | sh
```

From then on, **Settings → Updates** looks for new versions on the Mac mini. Each one is signed
with our release key (`scripts/release-keys.sh`), and Duet checks that before installing.

## 6. The two Macs

1. On the first Mac: **Settings → Sync & security → Set up sync**, and enter the Mac mini's
   address. Duet shows a 24-word recovery phrase once. Write it on paper; Duet checks three of
   the words.
2. Still on the first Mac, make a **join code**. It works once, for ten minutes.
3. On the second Mac, open Duet for the first time and choose **Join with a code from the other
   Mac**. It gets its own recovery phrase, and everything we've added comes down.

Either phrase alone opens all household data, so either of us can always look at it.

## Smart sorting (optional)

Rules, our own history, a starter pack of merchants and the bank's categories sort most rows on
each Mac with no help. The Mac mini can lend two models for the rest: an embedding model that
finds the past rows closest in meaning, and a small LLM for new merchants. Both run under
[Ollama](https://ollama.com), only on the Mac mini, and the service in front of them keeps
nothing.

```bash
brew install ollama uv
brew services start ollama
services/sync/deploy/duet-server install-sorter
```

It pulls the models (`nomic-embed-text` and `qwen2.5:7b-instruct` unless `DUET_EMBED_MODEL` and
`DUET_LLM_MODEL` say otherwise), starts the service under launchd and publishes it at `/sort`
next to the relay; Duet finds it there. Settings shows which models are ready.

To see whether they earn their place on our own data, replay what we've already sorted:

```bash
pnpm duet eval --sorter https://mac-mini.tail1234.ts.net/sort
```

It reports how many rows would need no correction with this Mac's steps alone, and with each
model added. Laya joins once it's fine-tuned on our history, and only if the evaluation says it
beats what came before.

## Backups

Every night the relay copies its database to `/usr/local/var/duet/backups`, keeping 30 daily
copies and the first copy of each of the last 12 months. The copies are ciphertext, so they can
go anywhere: Time Machine, or restic to a USB drive and a cloud bucket. Run one now with
`duet-server backup`.

## Updating

```bash
services/sync/deploy/duet-server update
```

It downloads the latest release with `gh`, checks the relay against its SHA-256, swaps the binary
and restarts it, then hands the new app to our Macs at `/app`. The relay accepts the app's current
protocol and the one before it, so the Macs and the Mac mini don't have to update at the same
moment. To update the sorting service too, `git pull` and run `duet-server install-sorter` again.

## Looking at our data

`duet export` asks for a recovery phrase (it's never stored or shown) and writes everything,
decrypted, as JSON, CSV and a SQLite file:

```bash
pnpm duet export --from /usr/local/var/duet/relay.db --out ~/duet-export
```

`--from` can also be any backup file, or the relay's `https://…ts.net` address from one of our
Macs. `pnpm duet inspect --from …` shows what's in a relay database without opening anything.

## A lost or new Mac

- **Lost:** on the other Mac, **Settings → Our devices → Remove**. It stops syncing right away.
- **New or wiped:** open Duet and choose **Restore from a recovery phrase**. The household comes
  back from the relay. Each person's Mine details and statement files lived only on their own
  Mac, so those come back only from that Mac's Time Machine.
