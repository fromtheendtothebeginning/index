// api.js — fetch 封装：统一携带 Bearer 鉴权头；401 自动清凭证并回登录页
// 登录 / 注册 / 重置密码等 401 属正常业务响应的公开接口不要走 apiFetch。

export function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('token')}` }
}

export async function apiFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (localStorage.getItem('token')) Object.assign(headers, authHeaders())
  const res = await fetch(url, { ...opts, headers })
  if (res.status === 401) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    window.location.href = '/auth'
    throw new Error('未登录或登录已过期')
  }
  return res
}
