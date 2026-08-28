import { describe, it, expect, beforeEach } from 'vitest'
import { createBackupPayload, validateBackupPayload, normalizeBackupData, BACKUP_VERSION } from './backup.js'
import { getStorageKey } from '../utils/environment.js'

describe('backup v2', () => {
  beforeEach(() => {
    const ls = () => {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
      if (globalThis.localStorage) return globalThis.localStorage
      if (!globalThis._mockLS) {
        const store = {}
        globalThis._mockLS = {
          getItem(k){return store[k]??null}, setItem(k,v){store[k]=String(v)}, removeItem(k){delete store[k]}, clear(){for(const k in store) delete store[k]}
        }
      }
      return globalThis._mockLS
    }
    const mock = ls()
    if (!globalThis.localStorage) globalThis.localStorage = mock
    try { if (typeof localStorage==='undefined') global.localStorage=mock }catch{}
    ls().clear()
  })

  it('v2 export contains folders, appearance, colorScheme', () => {
    const folders = [{ id:'f1', name:'Work', createdAt:new Date().toISOString()}]
    const links = [{ id:'1', originalUrl:'https://example.com', normalizedUrl:'https://example.com', url:'https://example.com', title:'T', description:'', image:'', tags:[], category:'Other', important:false, mustHave:false, favorite:false, folderId:'f1', domain:'example.com', createdAt:new Date().toISOString()}]
    const payload = createBackupPayload({ links, profile:{}, folders, appearance:'dark', colorScheme:'forest'})
    expect(payload.version).toBe(2)
    expect(payload.folders).toEqual(folders)
    expect(payload.settings).toEqual({ appearance:'dark', colorScheme:'forest'})
    expect(payload.links[0].folderId).toBe('f1')
  })

  it('defaults when not provided', () => {
    const payload = createBackupPayload({ links:[], profile:{} })
    expect(payload.settings).toEqual({ appearance:'system', colorScheme:'ocean'})
    expect(payload.folders).toEqual([])
  })

  it('v1 import migrates safely with defaults', () => {
    const v1 = { app:'Save_Link', version:1, exportedAt:new Date().toISOString(), profile:{}, links:[{ id:'1', originalUrl:'https://example.com', normalizedUrl:'https://example.com', title:'T', domain:'example.com'}]}
    const v = validateBackupPayload(v1)
    expect(v.valid).toBe(true)
    const norm = normalizeBackupData(v1)
    expect(norm.folders).toEqual([])
    expect(norm.settings).toEqual({ appearance:'system', colorScheme:'ocean'})
    expect(norm.links[0].folderId).toBeNull()
  })

  it('v2 import restores folders and settings', () => {
    const v2 = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{name:'A'}, settings:{appearance:'light', colorScheme:'amber'}, folders:[{id:'f1', name:'My Folder', createdAt:new Date().toISOString()}], links:[{ id:'1', originalUrl:'https://example.com', normalizedUrl:'https://example.com', folderId:'f1', title:'T'}]}
    expect(validateBackupPayload(v2).valid).toBe(true)
    const norm = normalizeBackupData(v2)
    expect(norm.folders.length).toBe(1)
    expect(norm.folders[0].name).toBe('My Folder')
    expect(norm.settings.appearance).toBe('light')
    expect(norm.settings.colorScheme).toBe('amber')
    expect(norm.links[0].folderId).toBe('f1')
  })

  it('invalid backup rejected', () => {
    expect(validateBackupPayload({ app:'Save_Link', version:999, links:[] }).valid).toBe(false)
    expect(validateBackupPayload({ app:'Wrong', version:2, links:[] }).valid).toBe(false)
    expect(validateBackupPayload({ app:'Save_Link', version:2 }).valid).toBe(false)
  })

  it('sanitizes folders and appearance', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{}, settings:{appearance:'invalid', colorScheme:'neon'}, folders:[{id:'', name:''}, {id:'f1', name:'Good'}, {id:'f1', name:'Duplicate'}], links:[]}
    const norm = normalizeBackupData(data)
    expect(norm.settings.appearance).toBe('system')
    expect(norm.settings.colorScheme).toBe('ocean')
    expect(norm.folders.length).toBe(1)
  })

  it('link with invalid folderId becomes null', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{}, folders:[{id:'f1', name:'F'}], links:[{ originalUrl:'https://example.com', folderId:'nonexistent', title:'T'}]}
    const norm = normalizeBackupData(data)
    expect(norm.links[0].folderId).toBeNull()
  })

  it('link folderId preserved when valid', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{}, folders:[{id:'f1', name:'F'}], links:[{ originalUrl:'https://example.com', folderId:'f1', title:'T'}]}
    const norm = normalizeBackupData(data)
    expect(norm.links[0].folderId).toBe('f1')
  })
})
