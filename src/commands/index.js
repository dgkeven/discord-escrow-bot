import * as vender from './vender.js';
import * as confirmar from './confirmar.js';
import * as disputa from './disputa.js';
import * as liberar from './liberar.js';
import { commands as operacao } from './operacao.js';
export const commands=[vender,confirmar,disputa,liberar,...operacao];
