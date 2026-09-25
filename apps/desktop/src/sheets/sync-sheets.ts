import {
  type DeviceInfo,
  makeJoinCode,
  normalizeRelayUrl,
  PROTOCOL,
  RelayClient,
  startHousehold,
} from "@duet/core";
import { css, html, nothing } from "lit";
import { Screen } from "../app/screen.ts";
import { timeAgo } from "../app/sync.ts";
import { sheetStyles } from "./new-account-sheet.ts";

const shared = css`
  .lede {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
    color: var(--du-ink-2);
  }
  .error {
    background: var(--du-warn-bg);
    color: var(--du-warn-fg);
    border-radius: 16px;
    padding: 10px 14px;
    font-size: 13.5px;
    font-weight: 700;
    line-height: 1.45;
  }
`;

/** Can this app talk to the relay at that address? Says why not, in words. */
export async function checkRelay(address: string): Promise<{ ready: boolean }> {
  const health = await new RelayClient(address).health();
  if (PROTOCOL > health.protocol) {
    throw new Error(
      "The Mac mini has an older Duet relay. Update it with duet-server update, then try again.",
    );
  }
  if (PROTOCOL < health.minProtocol)
    throw new Error("This Duet is older than the relay on the Mac mini. Update the app.");
  return { ready: health.ready };
}

/** Turning sync on, on the first Mac: the Mac mini's address, then a recovery phrase. */
export class SyncSetupSheet extends Screen {
  static override properties = {
    ...Screen.properties,
    address: { state: true },
    deviceName: { state: true },
    busy: { state: true },
    error: { state: true },
  };
  static override styles = [Screen.styles, sheetStyles, shared];

  declare address: string;
  declare deviceName: string;
  declare busy: boolean;
  declare error: string | null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.address = "";
    this.deviceName = `${this.basics.me?.name ?? "My"}'s Mac`;
    this.busy = false;
    this.error = null;
  }

  override render() {
    return html`<du-sheet label="Sync with the Mac mini" @close=${() => this.app.closeSheet()}>
      <form class="body" @submit=${this.connect}>
        <div class="head">
          <span class="badge"><du-icon name="server" size="22"></du-icon></span>
          <div>
            <h1>Sync with the Mac mini</h1>
            <div class="meta">Both Macs stay in step through it</div>
          </div>
        </div>
        <label class="field">The Mac mini's address
          <input
            class="big-input"
            placeholder="mac-mini.your-tailnet.ts.net"
            autocapitalize="off"
            spellcheck="false"
            .value=${this.address}
            @input=${(e: Event) => {
              this.address = (e.target as HTMLInputElement).value;
              this.error = null;
            }}
            autofocus
          />
          <span class="help">The HTTPS address tailscale serve gives Duet's relay.</span>
        </label>
        <label class="field">This Mac's name
          <input class="input" .value=${this.deviceName} @input=${(e: Event) => (this.deviceName = (e.target as HTMLInputElement).value)} />
        </label>
        <p class="lede">Locked end to end. The Mac mini only stores encrypted data.</p>
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        <div class="foot">
          <button type="button" class="linkish" @click=${() => this.app.closeSheet()}>Not now</button>
          <button class="btn" ?disabled=${!this.address.trim() || !this.deviceName.trim() || this.busy}>
            ${this.busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </du-sheet>`;
  }

  private connect = async (e: Event) => {
    e.preventDefault();
    this.busy = true;
    this.error = null;
    try {
      const address = normalizeRelayUrl(this.address);
      const { ready } = await checkRelay(address);
      if (ready) {
        throw new Error(
          "This Mac mini already has a household. To use it on this Mac, start Duet fresh here and join with a code from the other Mac, or restore with a recovery phrase.",
        );
      }
      const { phrase } = await startHousehold(this.app.store, this.app.platform.secret, {
        relayUrl: address,
        deviceName: this.deviceName.trim(),
      });
      void this.app.sync.start().then(() => this.app.sorting.check());
      this.app.replaceSheet({ kind: "phrase", phrase, next: { kind: "join-code" } });
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  };
}

/** A join code for the other one of us: works once, for ten minutes. */
export class JoinCodeSheet extends Screen {
  static override properties = {
    ...Screen.properties,
    code: { state: true },
    error: { state: true },
  };
  static override styles = [
    Screen.styles,
    sheetStyles,
    shared,
    css`
      .code {
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 12.5px;
        line-height: 1.5;
        word-break: break-all;
        background: var(--du-bg);
        border-radius: 16px;
        padding: 14px 16px;
        -webkit-user-select: all;
        user-select: all;
      }
      ol {
        margin: 0;
        padding-left: 20px;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.6;
        color: var(--du-ink-2);
      }
    `,
  ];

  declare code: string | null;
  declare error: string | null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.code = null;
    this.error = null;
    void this.make();
  }

  private async make() {
    const partner = this.basics.partner;
    if (!partner) return;
    this.code = null;
    this.error = null;
    try {
      const { code } = await makeJoinCode(this.app.store, this.app.platform.secret, {
        memberId: partner.id,
      });
      this.code = code;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  override render() {
    const partner = this.basics.partner?.name ?? "your partner";
    return html`<du-sheet label="Join code" @close=${() => this.app.closeSheet()}>
      <div class="body">
        <div class="head">
          <span class="badge" style="background:var(--du-mine-bg)"><du-icon name="link" size="22"></du-icon></span>
          <div>
            <h1>A join code for ${partner}</h1>
            <div class="meta">Works once, for the next 10 minutes</div>
          </div>
        </div>
        ${
          this.error
            ? html`<div class="error">${this.error}</div>`
            : this.code
              ? html`<div class="code" aria-label="Join code">${this.code}</div>`
              : html`<p class="lede">Making a code…</p>`
        }
        <ol>
          <li>On ${partner}'s Mac, open Duet and choose <b>Join with a code</b>.</li>
          <li>Paste this code there. It opens our data, so keep it between our own devices.</li>
        </ol>
        <div class="foot">
          <button class="linkish" @click=${() => void this.make()}>Make a new code</button>
          <span style="display:flex;gap:10px">
            <button class="btn soft" ?disabled=${!this.code} @click=${this.copy}>Copy</button>
            <button class="btn" @click=${() => this.app.closeSheet()}>Done</button>
          </span>
        </div>
      </div>
    </du-sheet>`;
  }

  private copy = async () => {
    if (!this.code) return;
    try {
      await navigator.clipboard.writeText(this.code);
      this.app.toast("Copied. Paste it on the other Mac.");
    } catch {
      this.app.toast("Couldn't copy. Select the code and copy it by hand.");
    }
  };
}

/** Every Mac paired with the Mac mini; a lost one can be removed. */
export class DevicesSheet extends Screen {
  static override properties = {
    ...Screen.properties,
    devices: { state: true },
    confirming: { state: true },
    error: { state: true },
  };
  static override styles = [
    Screen.styles,
    sheetStyles,
    shared,
    css`
      .device {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 2px dotted var(--du-line);
      }
      .device:last-child {
        border-bottom: 0;
      }
      .grow {
        flex-grow: 1;
        min-width: 0;
      }
      .name {
        font-size: 15px;
        font-weight: 800;
      }
    `,
  ];

  declare devices: DeviceInfo[] | null;
  declare confirming: string | null;
  declare error: string | null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.devices = null;
    this.confirming = null;
    this.error = null;
    void this.load();
  }

  private async load() {
    const client = this.app.sync.client;
    if (!client) {
      this.error = "Sync isn't set up on this Mac yet.";
      return;
    }
    try {
      this.devices = (await client.devices()).devices;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  override render() {
    return html`<du-sheet label="Our devices" @close=${() => this.app.closeSheet()}>
      <div class="body">
        <div class="head">
          <span class="badge"><du-icon name="lock" size="22"></du-icon></span>
          <div>
            <h1>Our devices</h1>
            <div class="meta">Each one holds the key to our data</div>
          </div>
        </div>
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        ${
          this.devices
            ? html`<div>
                ${this.devices.map(
                  (d) => html`<div class="device">
                    <du-avatar .name=${this.app.nameOf(d.memberId) || "?"} .color=${this.app.colorOf(d.memberId)} size="32"></du-avatar>
                    <div class="grow">
                      <div class="name">${d.name}${d.current ? html` <span class="pill good" style="margin-left:6px">This Mac</span>` : nothing}</div>
                      <div class="meta">${this.app.nameOf(d.memberId)}${d.lastSeenAt ? ` · last synced ${timeAgo(d.lastSeenAt)}` : ""}</div>
                    </div>
                    ${
                      d.current
                        ? nothing
                        : this.confirming === d.id
                          ? html`<span style="display:flex;gap:8px;align-items:center">
                              <button class="linkish muted" @click=${() => (this.confirming = null)}>Keep it</button>
                              <button class="btn small" @click=${() => void this.removeDevice(d)}>Remove</button>
                            </span>`
                          : html`<button class="linkish" @click=${() => (this.confirming = d.id)}>Remove</button>`
                    }
                  </div>`,
                )}
              </div>`
            : this.error
              ? nothing
              : html`<p class="lede">Asking the Mac mini…</p>`
        }
        <p class="lede">A removed Mac stops syncing right away. What's already on it stays there.</p>
        <div class="foot">
          <span></span>
          <button class="btn" @click=${() => this.app.closeSheet()}>Done</button>
        </div>
      </div>
    </du-sheet>`;
  }

  private async removeDevice(device: DeviceInfo) {
    try {
      await this.app.sync.client?.removeDevice(device.id);
      this.app.toast(`Removed ${device.name}.`);
      this.confirming = null;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }
}

customElements.define("du-sync-setup-sheet", SyncSetupSheet);
customElements.define("du-join-code-sheet", JoinCodeSheet);
customElements.define("du-devices-sheet", DevicesSheet);
