// tiny-stack-vm-01: a compact interpreter for make.fun's tiny stack ISA v1.
// Reads /input/<id>/program.bin + input.bin, writes /output/<id>/stdout.bin + exit.txt.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Per-opcode tables: IM = immediate byte length (-1 = not an opcode), PO = pops, PU = pushes.
const IM = new Int8Array(256).fill(-1);
const PO = new Int8Array(256);
const PU = new Int8Array(256);
const bin2 = (o) => { IM[o] = 0; PO[o] = 2; PU[o] = 1; };
IM[0] = 0;                                   // HALT
IM[1] = 1; PU[1] = 1;                        // PUSH8
IM[2] = 4; PU[2] = 1;                        // PUSH32
IM[3] = 0; PO[3] = 1;                        // POP
IM[4] = 0; PO[4] = 1; PU[4] = 2;             // DUP
IM[5] = 0; PO[5] = 2; PU[5] = 2;             // SWAP
IM[6] = 0; PO[6] = 2; PU[6] = 3;             // OVER
IM[7] = 0; PO[7] = 3; PU[7] = 3;             // ROT
for (let o = 0x10; o <= 0x1e; o++) bin2(o);  // arithmetic / bitwise / shifts
PO[0x17] = 1; PO[0x1b] = 1;                  // NEG, NOT are unary
for (let o = 0x20; o <= 0x22; o++) bin2(o);  // EQ, LT, LTU
IM[0x30] = 2;                                // JMP
IM[0x31] = 2; PO[0x31] = 1;                  // JZ
IM[0x32] = 2; PO[0x32] = 1;                  // JNZ
IM[0x33] = 2;                                // CALL
IM[0x34] = 0;                                // RET
IM[0x40] = 0; PO[0x40] = 1; PU[0x40] = 1;    // LOAD
IM[0x41] = 0; PO[0x41] = 2;                  // STORE
IM[0x50] = 0; PO[0x50] = 1;                  // PRINT
IM[0x51] = 0; PO[0x51] = 1;                  // PUTC
IM[0x52] = 0; PU[0x52] = 1;                  // IN
IM[0x53] = 0; PO[0x53] = 1;                  // EXIT

function run(p, inp) {
  const n = p.length;
  const st = new Int32Array(256);   // data stack
  const cs = new Int32Array(64);    // call stack
  const mem = new Int32Array(256);  // memory words
  const out = new Uint8Array(65536);
  let pc = 0, sp = 0, csp = 0, steps = 0, olen = 0, ipos = 0;
  const fin = (code) => ({ buf: Buffer.from(out.subarray(0, olen)), code });
  for (;;) {
    if (steps === 1000000) return fin(10);
    if (pc < 0 || pc >= n) return fin(9);
    const op = p[pc], im = IM[op];
    if (im < 0) return fin(5);
    if (pc + im >= n) return fin(9);
    steps++;
    if (sp < PO[op]) return fin(2);
    if (sp - PO[op] + PU[op] > 256) return fin(3);
    const nx = pc + 1 + im;
    switch (op) {
      case 0x00: return fin(0);
      case 0x01: st[sp++] = (p[pc + 1] << 24) >> 24; break;
      case 0x02: st[sp++] = p[pc + 1] | (p[pc + 2] << 8) | (p[pc + 3] << 16) | (p[pc + 4] << 24); break;
      case 0x03: sp--; break;
      case 0x04: st[sp] = st[sp - 1]; sp++; break;
      case 0x05: { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; break; }
      case 0x06: st[sp] = st[sp - 2]; sp++; break;
      case 0x07: { const a = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = a; break; }
      case 0x10: sp--; st[sp - 1] = st[sp - 1] + st[sp]; break;
      case 0x11: sp--; st[sp - 1] = st[sp - 1] - st[sp]; break;
      case 0x12: sp--; st[sp - 1] = Math.imul(st[sp - 1], st[sp]); break;
      case 0x13: { const b = st[--sp], a = st[sp - 1]; if (b === 0) return fin(4); st[sp - 1] = (a - (a % b)) / b; break; }
      case 0x14: { const b = st[--sp], a = st[sp - 1]; if (b === 0) return fin(4); st[sp - 1] = a % b; break; }
      case 0x15: { const b = st[--sp] >>> 0, a = st[sp - 1] >>> 0; if (b === 0) return fin(4); st[sp - 1] = (a - (a % b)) / b; break; }
      case 0x16: { const b = st[--sp] >>> 0, a = st[sp - 1] >>> 0; if (b === 0) return fin(4); st[sp - 1] = a % b; break; }
      case 0x17: st[sp - 1] = -st[sp - 1]; break;
      case 0x18: sp--; st[sp - 1] = st[sp - 1] & st[sp]; break;
      case 0x19: sp--; st[sp - 1] = st[sp - 1] | st[sp]; break;
      case 0x1a: sp--; st[sp - 1] = st[sp - 1] ^ st[sp]; break;
      case 0x1b: st[sp - 1] = ~st[sp - 1]; break;
      case 0x1c: sp--; st[sp - 1] = st[sp - 1] << st[sp]; break;
      case 0x1d: sp--; st[sp - 1] = st[sp - 1] >> st[sp]; break;
      case 0x1e: sp--; st[sp - 1] = st[sp - 1] >>> st[sp]; break;
      case 0x20: sp--; st[sp - 1] = st[sp - 1] === st[sp] ? 1 : 0; break;
      case 0x21: sp--; st[sp - 1] = st[sp - 1] < st[sp] ? 1 : 0; break;
      case 0x22: sp--; st[sp - 1] = (st[sp - 1] >>> 0) < (st[sp] >>> 0) ? 1 : 0; break;
      case 0x30: pc = nx + (((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16); continue;
      case 0x31: pc = st[--sp] === 0 ? nx + (((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16) : nx; continue;
      case 0x32: pc = st[--sp] !== 0 ? nx + (((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16) : nx; continue;
      case 0x33: {
        if (csp === 64) return fin(7);
        cs[csp++] = nx;
        pc = p[pc + 1] | (p[pc + 2] << 8);
        continue;
      }
      case 0x34: if (csp === 0) return fin(8); pc = cs[--csp]; continue;
      case 0x40: { const a = st[sp - 1]; if (a < 0 || a > 255) return fin(6); st[sp - 1] = mem[a]; break; }
      case 0x41: { const a = st[--sp], v = st[--sp]; if (a < 0 || a > 255) return fin(6); mem[a] = v; break; }
      case 0x50: {
        const s = String(st[--sp]);
        if (olen + s.length > 65536) return fin(11);
        for (let k = 0; k < s.length; k++) out[olen++] = s.charCodeAt(k);
        break;
      }
      case 0x51: if (olen + 1 > 65536) return fin(11); out[olen++] = st[--sp] & 255; break;
      case 0x52: st[sp++] = ipos < inp.length ? inp[ipos++] : -1; break;
      case 0x53: return fin(st[--sp] & 255);
    }
    pc = nx;
  }
}

for (const id of readdirSync(I).sort()) {
  const dir = join(O, id);
  mkdirSync(dir, { recursive: true });
  let prog = Buffer.alloc(0), inp = Buffer.alloc(0);
  try { prog = readFileSync(join(I, id, 'program.bin')); } catch {}
  try { inp = readFileSync(join(I, id, 'input.bin')); } catch {}
  const r = run(prog, inp);
  writeFileSync(join(dir, 'stdout.bin'), r.buf);
  writeFileSync(join(dir, 'exit.txt'), r.code + '\n');
}
