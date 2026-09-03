import { describe, it, expect } from 'vitest'
import {
  PASSWORD_RULES,
  passwordChecks,
  passwordValid,
  checkPassword,
  checkEmail,
  validateSignIn,
  validateRegister,
  validateForgotPassword,
  validateForgotUsername,
} from './authValidation.js'

describe('passwordChecks — requirements', () => {
  it('a valid password meets every requirement', () => {
    const c = passwordChecks('Abcd1234!')
    expect(c).toEqual({ length: true, uppercase: true, lowercase: true, number: true, symbol: true, noSpaces: true })
    expect(passwordValid('Abcd1234!')).toBe(true)
  })

  it('length: minimum 8', () => {
    expect(passwordChecks('Ab1!x').length).toBe(false) // 5 chars
    expect(passwordChecks('Abc1234!').length).toBe(true) // 8 chars
  })

  it('length: maximum 12', () => {
    expect(passwordChecks('Abcdef1234!x').length).toBe(true) // exactly 12 chars
    expect(passwordChecks('Abcdef12345!x').length).toBe(false) // 13 chars
  })

  it('requires an uppercase letter', () => {
    expect(passwordChecks('abcdefg1!').uppercase).toBe(false)
    expect(passwordChecks('Abcdefg1!').uppercase).toBe(true)
  })

  it('requires a lowercase letter', () => {
    expect(passwordChecks('ABCDEFG1!').lowercase).toBe(false)
    expect(passwordChecks('Abcdefg1!').lowercase).toBe(true)
  })

  it('requires a number', () => {
    expect(passwordChecks('Abcdefgh!').number).toBe(false)
    expect(passwordChecks('Abcdefg1!').number).toBe(true)
  })

  it('requires a symbol', () => {
    expect(passwordChecks('Abcdefg1').symbol).toBe(false)
    expect(passwordChecks('Abcdefg1!').symbol).toBe(true)
  })

  it('rejects spaces', () => {
    expect(passwordChecks('Ab cd1234!').noSpaces).toBe(false)
    expect(passwordChecks('Abcd1234 ').noSpaces).toBe(false)
  })

  it('password is invalid when any single requirement is missing', () => {
    expect(passwordValid('abcdefg1!')).toBe(false) // no uppercase
    expect(passwordValid('ABCDEFG1!')).toBe(false) // no lowercase
    expect(passwordValid('Abcdefgh!')).toBe(false) // no number
    expect(passwordValid('Abcdefg1')).toBe(false) // no symbol
    expect(passwordValid('Abcdefg12')).toBe(false) // no symbol
    expect(passwordValid('Abcdefg1! ')).toBe(false) // space
  })

  it('checkPassword gives a clear error and passes on a valid value', () => {
    expect(checkPassword('')).toMatch(/password/i)
    expect(checkPassword('Abcdefg1!')).toBe('')
    expect(checkPassword('weak')).toMatch(/requirements/i)
  })
})

describe('checkEmail', () => {
  it('rejects empty and malformed addresses', () => {
    expect(checkEmail('')).toMatch(/email/i)
    expect(checkEmail('   ')).toMatch(/email/i)
    expect(checkEmail('nope')).toMatch(/valid email/i)
    expect(checkEmail('a@b')).toMatch(/valid email/i)
  })
  it('accepts a well-formed address', () => {
    expect(checkEmail('user@example.com')).toBe('')
  })
})

describe('validateSignIn', () => {
  it('requires an identifier and password', () => {
    const r = validateSignIn({})
    expect(r.valid).toBe(false)
    expect(r.errors.usernameOrEmail).toMatch(/username or email/i)
    expect(r.errors.password).toMatch(/password/i)
  })
  it('passes when both are present', () => {
    expect(validateSignIn({ usernameOrEmail: 'alice', password: 'x' }).valid).toBe(true)
  })
})

describe('validateRegister', () => {
  it('requires username, email, password, and matching confirmation', () => {
    const r = validateRegister({})
    expect(r.valid).toBe(false)
    expect(r.errors.username).toMatch(/username/i)
    expect(r.errors.email).toMatch(/email/i)
    expect(r.errors.password).toMatch(/password/i)
  })
  it('rejects a username outside the allowed pattern', () => {
    expect(validateRegister({ username: 'ab', email: 'a@b.co', password: 'Abcd1234!', confirmPassword: 'Abcd1234!' }).valid).toBe(false)
    expect(validateRegister({ username: 'ok_name-2', email: 'a@b.co', password: 'Abcd1234!', confirmPassword: 'Abcd1234!' }).valid).toBe(true)
  })
  it('rejects a mismatch between password and confirmation', () => {
    const r = validateRegister({ username: 'alice', email: 'a@b.co', password: 'Abcd1234!', confirmPassword: 'Different!' })
    expect(r.valid).toBe(false)
    expect(r.errors.confirmPassword).toMatch(/match/i)
  })
  it('passes a fully valid registration', () => {
    const r = validateRegister({ username: 'alice', email: 'alice@example.com', password: 'Abcd1234!', confirmPassword: 'Abcd1234!' })
    expect(r.valid).toBe(true)
  })
})

describe('forgot forms', () => {
  it('forgot password requires an identifier', () => {
    expect(validateForgotPassword({}).valid).toBe(false)
    expect(validateForgotPassword({ usernameOrEmail: 'alice' }).valid).toBe(true)
  })
  it('forgot username requires a valid email', () => {
    expect(validateForgotUsername({}).valid).toBe(false)
    expect(validateForgotUsername({ email: 'alice@example.com' }).valid).toBe(true)
    expect(validateForgotUsername({ email: 'nope' }).valid).toBe(false)
  })
})

describe('PASSWORD_RULES surfaced for UI', () => {
  it('exposes min and max for the requirements list', () => {
    expect(PASSWORD_RULES).toEqual({ min: 8, max: 12 })
  })
})
