# Setting up the Mac mini

Duet runs on our two Macs. A Mac mini at home relays encrypted changes between them (and, from
M4, runs the local models that help with sorting). It only ever stores ciphertext: whoever holds
a recovery phrase can open the data, and nobody else can, including the Mac mini itself.

| Service | How it runs | Reachable at |
| --- | --- | --- |
| Tailscale | The open-source `tailscaled` daemon, so it runs with nobody logged in | — |
| Duet relay | `duet-sync`, one binary, a LaunchDaemon that restarts it if it stops | 127.0.0.1:8787, published over HTTPS by `tailscale serve` |
| Nightly backup | `duet-sync backup`, a LaunchDaemon at 03:15 | `/usr/local/var/duet/backups` |
| Nightly update | `duet-server update`, a LaunchDaemon at 04:30 (optional) | — |

Duet itself comes from [GitHub releases](https://github.com/firstprateek/duet/releases), and each
Mac updates itself from there.

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

## 2. A copy of Duet

The commands below run from a copy of this repository:

```bash
git clone https://github.com/firstprateek/duet.git ~/duet
cd ~/duet
```

`git pull` brings it up to date.

## 3. Keep it awake

```bash
services/sync/deploy/duet-server keep-awake
```

It never sleeps, and starts again after a power cut.

## 4. The relay

Take it from the latest release, or build it on one of our Macs (it needs [Bun](https://bun.sh))
and copy it over:

```bash
curl -fsSLo /tmp/duet-sync https://github.com/firstprateek/duet/releases/latest/download/duet-sync-darwin-arm64
chmod +x /tmp/duet-sync
services/sync/deploy/duet-server install /tmp/duet-sync

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

On each Mac, open the [download page](https://firstprateek.github.io/duet/), or run:

```bash
curl -fsSL https://firstprateek.github.io/duet/install.sh | sh
```

**Settings → Updates** finds new versions on GitHub. Each one is signed with our release key
(`scripts/release-keys.sh`), and Duet checks that before installing.

## 6. The two Macs

1. On the first Mac: **Settings → Sync & security → Set up sync**, and enter the Mac mini's
   address. Duet shows a 24-word recovery phrase once. Write it on paper; Duet checks three of
   the words.
2. Still on the first Mac, make a **join link** and send it to the other Mac (AirDrop or Messages).
   It works once, within a day. The code in it sits after the `#`, so it never reaches a server.
3. On the second Mac, open the link. Its page installs Duet, then **Open in Duet** goes straight
   to joining. (Or open Duet, choose **Join with a code from the other Mac** and paste the link.)
   The second Mac gets its own recovery phrase, and everything we've added comes down. It has
   to be on the tailnet to reach the Mac mini.

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
services/sync/deploy/duet-server update        # now
services/sync/deploy/duet-server auto-update   # or every night at 04:30
```

`update` looks at the latest GitHub release. If its relay is newer, it downloads it, checks it
against its SHA-256, swaps the binary and restarts it. The relay accepts the app's current
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
