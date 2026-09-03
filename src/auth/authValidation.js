// Client-side validation for the online account/auth forms (Phase 4 — Auth UI).
//
// Pure, dependency-free functions so the UI forms and the validator are both
// easy to unit-test. These run BEFORE any backend call; the backend (when it
// exists) MUST re-validate — client validation is UX, never a security
// boundary.
export const PASSWORD_RULES = { min: 8, max: 12 }

export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,20}$/
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Evaluate every password requirement. Returns an object with one boolean per
 * rule plus overall `valid`. A value is valid only when ALL rules are met.
 * @param {string} value
 */
export function passwordChecks(value = '') {
  const v = String(value)
  return {
    length: v.length >= PASSWORD_RULES.min && v.length <= PASSWORD_RULES.max,
    uppercase: /[A-Z]/.test(v),
    lowercase: /[a-z]/.test(v),
    number: /[0-9]/.test(v),
    symbol: /[^A-Za-z0-9]/.test(v),
    noSpaces: !/\s/.test(v),
  }
}

/** @param {string} value */
export function passwordValid(value = '') {
  const checks = passwordChecks(value)
  return Object.values(checks).every(Boolean)
}

/** @param {string} value @returns {string} '' when valid, else an error message */
export function checkPassword(value = '') {
  if (!value) return 'Create a password'
  return passwordValid(value) ? '' : 'Password does not meet the requirements'
}

/** @param {string} value @returns {string} '' when valid, else an error message */
export function checkEmail(value = '') {
  const email = String(value).trim()
  if (!email) return 'Enter your email address'
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address'
  return ''
}

/**
 * Validate the Sign In form.
 * @param {{ usernameOrEmail: string, password: string }}
 * @returns {{ errors: Object<string,string>, valid: boolean }}
 */
export function validateSignIn({ usernameOrEmail = '', password = '' } = {}) {
  const errors = {}
  if (!String(usernameOrEmail).trim()) errors.usernameOrEmail = 'Enter your username or email'
  if (!password) errors.password = 'Enter your password'
  return { errors, valid: Object.keys(errors).length === 0 }
}

/**
 * Validate the Create Account form.
 * @param {{ username: string, email: string, password: string, confirmPassword: string }}
 * @returns {{ errors: Object<string,string>, valid: boolean }}
 */
export function validateRegister({ username = '', email = '', password = '', confirmPassword = '' } = {}) {
  const errors = {}
  const name = String(username).trim()
  if (!name) {
    errors.username = 'Choose a username'
  } else if (!USERNAME_PATTERN.test(name)) {
    errors.username = 'Use 3–20 letters, numbers, dots, dashes or underscores'
  }
  const emailErr = checkEmail(email)
  if (emailErr) errors.email = emailErr
  const passErr = checkPassword(password)
  if (passErr) errors.password = passErr
  if (password && confirmPassword !== password) errors.confirmPassword = 'Passwords do not match'
  return { errors, valid: Object.keys(errors).length === 0 }
}

/**
 * Validate a Forgot Password submission.
 * @param {{ usernameOrEmail: string }}
 */
export function validateForgotPassword({ usernameOrEmail = '' } = {}) {
  const errors = {}
  if (!String(usernameOrEmail).trim()) errors.usernameOrEmail = 'Enter your username or email'
  return { errors, valid: Object.keys(errors).length === 0 }
}

/**
 * Validate a Forgot Username submission.
 * @param {{ email: string }}
 */
export function validateForgotUsername({ email = '' } = {}) {
  const errors = {}
  const emailErr = checkEmail(email)
  if (emailErr) errors.email = emailErr
  return { errors, valid: Object.keys(errors).length === 0 }
}
