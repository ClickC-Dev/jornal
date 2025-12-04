import assert from 'assert'
import { sanitizeBaseName, pickBackIndex, zipSafeName } from '../server/lib.js'

assert.strictEqual(sanitizeBaseName('Lucas Contábil.png'), 'Lucas Contábil')
assert.strictEqual(sanitizeBaseName('MR4.PNG'), 'MR4')
assert.strictEqual(sanitizeBaseName('Lico: Contabilidade.pdf'), 'Lico Contabilidade')

assert.strictEqual(zipSafeName('ADCON Contábil'), 'ADCON Contabil')

assert.strictEqual(pickBackIndex(0, 3, 3), 0)
assert.strictEqual(pickBackIndex(1, 3, 3), 1)
assert.strictEqual(pickBackIndex(2, 3, 1), 0)

let threw = false
try { pickBackIndex(0, 3, 2) } catch { threw = true }
assert.strictEqual(threw, true)

console.log('Testes de lógica passaram com sucesso')
