const { Telegraf, session } = require('telegraf');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// تنظیمات اولیه
const ADMIN_ID = youre-user-id; // ID تلگرام ادمین
const bot = new Telegraf('telegrambottoken-here'); // توکن بات تلگرام
bot.use(session());
const PAGE_URL = 'https://dashboard.solixdepin.net/sign-up';
const SITEKEY = '0x4AAAAAABD9Dqblkacz6ou7';
let isMining = false;
let miningInterval = null;
let stopRequested = false;

// کش توکن‌ها
const tokenCache = new Map(); // { email: { token, expiresAt } }

// تابع مدیریت امن درخواست‌های تلگرام
const safeTelegramCall = async (ctx, fn, errorMessage) => {
  if (!ctx.from) {
    console.log('No user info available');
    return false;
  }
  try {
    await fn();
    return true;
  } catch (e) {
    console.log(`${errorMessage} for ${ctx.from.id}: ${e.message}`);
    if (e.response?.error_code === 403) {
      return false; // کاربر بات را بلاک کرده، ادامه نده
    }
    throw e; // سایر خطاها را پرتاب کن
  }
};

// تابع نمایش منوی اصلی
const showMainMenu = async (ctx) => {
  const accounts = await readAccounts();
  const proxies = await readProxies();
  const apiKey = await readApiKey();
  const success = await safeTelegramCall(
    ctx,
    () => ctx.reply(
      `تعداد اکانت‌ها: ${accounts.length}\n` +
      `تعداد پراکسی‌ها: ${proxies.length}\n` +
      `API کپچا: ${apiKey ? 'ست شده' : 'ست نشده'}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Captcha API Set', callback_data: 'set_api' }],
            [{ text: 'Account List', callback_data: 'list_accounts' }],
            [{ text: 'Add Account', callback_data: 'add_account' }],
            [{ text: 'Do Tasks', callback_data: 'do_tasks' }],
            [{ text: 'Register', callback_data: 'register' }],
            [{ text: 'Mining', callback_data: 'mining' }],
            [{ text: 'Stop', callback_data: 'stop' }]
          ]
        }
      }
    ),
    'Error sending main menu'
  );
  if (!success) return;
};

// توابع کمکی
const headers = (method = 'get', token = null) => {
  const header = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  };
  if (method === 'post') {
    header['Content-Type'] = 'application/json';
  }
  if (token) {
    header['Authorization'] = `Bearer ${token}`;
  }
  return header;
};

const randomString = (length = 10) => {
  const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => characters[Math.floor(Math.random() * characters.length)]).join('');
};

const randomInt = (length = 10) => {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
};

const readAccounts = async () => {
  try {
    const data = await fs.readFile('accounts.json', 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.log('Error reading accounts.json:', e.message);
    return [];
  }
};

const saveAccount = async (email, password, proxy = null) => {
  const accounts = await readAccounts();
  accounts.push({ email, password, proxy });
  await fs.writeFile('accounts.json', JSON.stringify(accounts, null, 4));
  console.log(`Saved account: ${email} with proxy: ${proxy || 'none'}`);
};

const readProxies = async () => {
  try {
    const data = await fs.readFile('proxy.txt', 'utf8');
    const proxies = data.split('\n').filter(line => line.trim()).map(line => line.trim());
    console.log(`Loaded ${proxies.length} proxies from proxy.txt`);
    return proxies;
  } catch (e) {
    console.log('Error reading proxy.txt:', e.message);
    return [];
  }
};

const readApiKey = async () => {
  try {
    const data = await fs.readFile('apikey.txt', 'utf8');
    return data.trim();
  } catch (e) {
    console.log('Error reading apikey.txt:', e.message);
    return '';
  }
};

const saveApiKey = async (apiKey) => {
  await fs.writeFile('apikey.txt', apiKey.trim());
  console.log('Saved API key');
};

// انتخاب پراکسی موجود
const getAvailableProxy = async () => {
  const proxies = await readProxies();
  const accounts = await readAccounts();
  const usedProxies = accounts.map(acc => acc.proxy).filter(p => p);
  for (const proxy of proxies) {
    if (!usedProxies.includes(proxy) && await validateProxy(proxy)) {
      console.log(`Selected proxy: ${proxy}`);
      return proxy;
    }
  }
  console.log('No valid proxy available');
  return null;
};

// اعتبارسنجی پراکسی
const validateProxy = async (proxy) => {
  if (!proxy) return false;
  try {
    const config = { httpsAgent: new HttpsProxyAgent(proxy), timeout: 15000 };
    const response = await axios.get('https://api.ipify.org', config);
    console.log(`Proxy ${proxy} is valid, IP: ${response.data}`);
    return true;
  } catch (e) {
    console.log(`Proxy ${proxy} is invalid: ${e.message}`);
    return false;
  }
};

// تابع retry با مدیریت پراکسی‌های جایگزین
const retry = async (fn, retries = 5, delay = 2000, proxyList = []) => {
  let currentProxy = proxyList[0] || null;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn(currentProxy);
    } catch (e) {
      console.log(`Retry ${i + 1} failed: ${e.message}`);
      if (i === retries - 1) throw e;
      if (proxyList.length > i + 1) {
        currentProxy = proxyList[i + 1] || null;
        console.log(`Switching to proxy: ${currentProxy || 'no proxy'}`);
      }
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
};

// حل کپچا
const solver = async (proxy) => {
  const APIKEY = await readApiKey();
  if (!APIKEY) throw new Error('API Key not set');
  const config = { timeout: 180000 };
  if (proxy && await validateProxy(proxy)) {
    config.httpsAgent = new HttpsProxyAgent(proxy);
  }
  const proxies = proxy ? [proxy, ...(await readProxies())] : await readProxies();
  return retry(async (currentProxy) => {
    if (currentProxy) config.httpsAgent = new HttpsProxyAgent(currentProxy);
    else delete config.httpsAgent;
    const response = await axios.get(`https://api.sctg.xyz/in.php?key=${APIKEY}&method=turnstile&pageurl=${PAGE_URL}&sitekey=${SITEKEY}`, config);
    const id = response.data.replace('OK|', '');
    console.log(`Captcha ID: ${id}`);
    while (true) {
      const req = await axios.get(`https://api.sctg.xyz/res.php?key=${APIKEY}&id=${id}`, config);
      if (req.data === 'CAPCHA_NOT_READY') {
        console.log('CAPCHA_NOT_READY');
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        const token = req.data.replace('OK|', '');
        console.log(`Captcha token: ${token}`);
        return token;
      }
    }
  }, 5, 2000, proxies);
};

// توابع API
const login = async (email, password, proxy) => {
  const url = 'https://api.solixdepin.net/api/auth/login-password';
  const payload = { email, password };
  const config = { headers: headers('post'), timeout: 180000 };
  const proxies = proxy ? [proxy, ...(await readProxies())] : await readProxies();
  try {
    const token = await retry(async (currentProxy) => {
      if (currentProxy) config.httpsAgent = new HttpsProxyAgent(currentProxy);
      else delete config.httpsAgent;
      await new Promise(resolve => setTimeout(resolve, 2000)); // تاخیر 2 ثانیه
      const response = await axios.post(url, payload, config);
      if (response.data.result === 'success') {
        console.log(`Login successful for ${email}`);
        return response.data.data.accessToken;
      }
      console.log(`Login failed for ${email}: ${JSON.stringify(response.data)}`);
      return null;
    }, 5, 2000, proxies);
    if (token) {
      // ذخیره توکن با زمان انقضا (1 ساعت)
      tokenCache.set(email, {
        token,
        expiresAt: Date.now() + 3600000 // 1 ساعت
      });
    }
    return token;
  } catch (e) {
    console.log(`Login error for ${email}: ${e.message}`);
    return null;
  }
};

const getPoint = async (token, proxy) => {
  const url = 'https://api.solixdepin.net/api/point/get-total-point';
  const config = { headers: headers('get', token), timeout: 180000 };
  const proxies = proxy ? [proxy, ...(await readProxies())] : await readProxies();
  try {
    return await retry(async (currentProxy) => {
      if (currentProxy) config.httpsAgent = new HttpsProxyAgent(currentProxy);
      else delete config.httpsAgent;
      await new Promise(resolve => setTimeout(resolve, 2000)); // تاخیر 2 ثانیه
      const response = await axios.get(url, config);
      if (response.data.result === 'success') {
        console.log(`Got points: ${response.data.data.total}`);
        return response.data.data.total;
      }
      console.log(`Get point failed: ${JSON.stringify(response.data)}`);
      return null;
    }, 5, 2000, proxies);
  } catch (e) {
    console.log(`Get point error: ${e.message}`);
    throw e; // برای بررسی توکن منقضی شده
  }
};

const getTasks = async (token, proxy) => {
  const url = 'https://api.solixdepin.net/api/task/get-user-task';
  const config = { headers: headers('get', token), timeout: 180000 };
  const proxies = proxy ? [proxy, ...(await readProxies())] : await readProxies();
  return retry(async (currentProxy) => {
    if (currentProxy) config.httpsAgent = new HttpsProxyAgent(currentProxy);
    else delete config.httpsAgent;
    await new Promise(resolve => setTimeout(resolve, 2000)); // تاخیر 2 ثانیه
    const response = await axios.get(url, config);
    console.log(`Got tasks: ${response.data.data.length} tasks`);
    return response.data.data;
  }, 5, 2000, proxies);
};

const doTask = async (token, taskId, proxy) => {
  const url = 'https://api.solixdepin.net/api/task/do-task';
  const payload = { taskId };
  const config = { headers: headers('post', token), timeout: 180000 };
  const proxies = proxy ? [proxy, ...(await readProxies())] : await readProxies();
  return retry(async (currentProxy) => {
    if (currentProxy) config.httpsAgent = new HttpsProxyAgent(currentProxy);
    else delete config.httpsAgent;
    await new Promise(resolve => setTimeout(resolve, 2000)); // تاخیر 2 ثانیه
    const response = await axios.post(url, payload, config);
    console.log(`Do task ${taskId}: ${JSON.stringify(response.data)}`);
    return response.data;
  }, 5, 2000, proxies);
};

const claimTask = async (token, taskId, proxy) => {
  const url = 'https://api.solixdepin.net/api/task/claim-task';
  const payload = { taskId };
  const config = { headers: headers('post', token), timeout: 180000 };
  const proxies = proxy ? [proxy, ...(await readProxies())] : await readProxies();
  return retry(async (currentProxy) => {
    if (currentProxy) config.httpsAgent = new HttpsProxyAgent(currentProxy);
    else delete config.httpsAgent;
    await new Promise(resolve => setTimeout(resolve, 2000)); // تاخیر 2 ثانیه
    const response = await axios.post(url, payload, config);
    console.log(`Claim task ${taskId}: ${JSON.stringify(response.data)}`);
    return response.data;
  }, 5, 2000, proxies);
};

const register = async (email, password, referralCode, proxy = null, retries = 2) => {
  const url = 'https://api.solixdepin.net/api/auth/register';
  let captchaToken;
  try {
    captchaToken = await solver(proxy);
  } catch (e) {
    console.log(`Failed to get captcha token for ${email}: ${e.message}`);
    return false;
  }
  const payload = { email, password, captchaToken, referralCode };
  const config = { headers: headers('post'), timeout: 180000 };
  const proxies = proxy ? [proxy, ...(await readProxies())] : await readProxies();
  try {
    const response = await retry(async (currentProxy) => {
      if (currentProxy) config.httpsAgent = new HttpsProxyAgent(currentProxy);
      else delete config.httpsAgent;
      await new Promise(resolve => setTimeout(resolve, 2000)); // تاخیر 2 ثانیه
      return await axios.post(url, payload, config);
    }, 5, 2000, proxies);
    if (response.data.result === 'success') {
      await saveAccount(email, password, proxy);
      console.log(`Registered ${email} successfully`);
      return true;
    }
    console.log(`Register failed for ${email}: ${JSON.stringify(response.data)}`);
    return false;
  } catch (e) {
    console.log(`Register error for ${email}: ${e.message}`);
    if (e.response?.data?.message === 'Invalid captcha token' && retries > 0) {
      console.log(`Retrying register for ${email} (${retries} retries left)`);
      return register(email, password, referralCode, proxy, retries - 1);
    }
    return false;
  }
};

// میدل‌ور برای چک کردن ادمین
const checkAdmin = async (ctx, next) => {
  if (!ctx.from) {
    console.log('No user info available');
    return;
  }
  if (ctx.from.id !== ADMIN_ID) {
    console.log(`Unauthorized access attempt by user ${ctx.from.id}`);
    const success = await safeTelegramCall(
      ctx,
      () => ctx.reply('فقط ادمین می‌تونه از این بات استفاده کنه!'),
      'Error replying to unauthorized user'
    );
    return;
  }
  return next();
};

// مدیریت خطای کلی بات
bot.catch((err, ctx) => {
  console.error(`Global error for ${ctx.from?.id || 'unknown'}: ${err.message}`);
  if (err.response?.error_code === 403) {
    console.log(`Bot blocked by user ${ctx.from?.id || 'unknown'}, ignoring...`);
    return;
  }
});

bot.use(checkAdmin);

bot.start(async (ctx) => {
  await showMainMenu(ctx);
});

// تنظیم API کپچا
bot.action('set_api', (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.waitingForApiKey = true;
  safeTelegramCall(
    ctx,
    () => ctx.reply('لطفاً کلید API کپچا را وارد کنید:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
      }
    }),
    'Error sending set_api message'
  );
});

bot.action('back_to_home', async (ctx) => {
  ctx.session = {};
  await showMainMenu(ctx);
});

bot.on('text', async (ctx) => {
  if (!ctx.session) return;

  // تنظیم API کپچا
  if (ctx.session.waitingForApiKey) {
    const apiKey = ctx.message.text;
    await saveApiKey(apiKey);
    await safeTelegramCall(
      ctx,
      () => ctx.reply('کلید API ذخیره شد!', {
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error replying to set_api'
    );
    ctx.session.waitingForApiKey = false;
    return;
  }

  // اضافه کردن اکانت
  if (ctx.session.waitingForEmail) {
    ctx.session.email = ctx.message.text;
    ctx.session.waitingForEmail = false;
    ctx.session.waitingForPassword = true;
    await safeTelegramCall(
      ctx,
      () => ctx.reply('پسورد اکانت را وارد کنید:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error sending password prompt'
    );
    return;
  }
  if (ctx.session.waitingForPassword) {
    ctx.session.password = ctx.message.text;
    ctx.session.waitingForPassword = false;
    const proxy = await getAvailableProxy();
    await saveAccount(ctx.session.email, ctx.session.password, proxy);
    await safeTelegramCall(
      ctx,
      () => ctx.reply(`اکانت ${ctx.session.email} با پراکسی ${proxy || 'بدون پراکسی'} اضافه شد.`, {
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error replying to add_account'
    );
    ctx.session.waitingForPassword = false;
    delete ctx.session.email;
    delete ctx.session.password;
    return;
  }

  // ثبت‌نام
  if (ctx.session.waitingForReferral) {
    ctx.session.referralCode = ctx.message.text;
    ctx.session.waitingForReferral = false;
    ctx.session.waitingForNameMail = true;
    await safeTelegramCall(
      ctx,
      () => ctx.reply('نام پایه ایمیل (بدون @gmail.com) را وارد کنید:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error sending name mail prompt'
    );
    return;
  }
  if (ctx.session.waitingForNameMail) {
    ctx.session.nameMail = ctx.message.text;
    ctx.session.waitingForNameMail = false;
    ctx.session.waitingForPasswordReg = true;
    await safeTelegramCall(
      ctx,
      () => ctx.reply('پسورد را وارد کنید:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error sending password reg prompt'
    );
    return;
  }
  if (ctx.session.waitingForPasswordReg) {
    ctx.session.password = ctx.message.text;
    ctx.session.waitingForPasswordReg = false;
    ctx.session.waitingForLoop = true;
    await safeTelegramCall(
      ctx,
      () => ctx.reply('تعداد اکانت‌ها را وارد کنید:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error sending loop prompt'
    );
    return;
  }
  if (ctx.session.waitingForLoop) {
    const loop = parseInt(ctx.message.text);
    if (isNaN(loop) || loop <= 0) {
      await safeTelegramCall(
        ctx,
        () => ctx.reply('لطفاً یک عدد معتبر وارد کنید.', {
          reply_markup: {
            inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
          }
        }),
        'Error replying to invalid loop'
      );
      return;
    }
    for (let i = 1; i <= loop; i++) {
      if (stopRequested) {
        await safeTelegramCall(
          ctx,
          () => ctx.reply('عملیات متوقف شد.', {
            reply_markup: {
              inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
            }
          }),
          'Error replying to stop'
        );
        stopRequested = false;
        break;
      }
      const email = `${ctx.session.nameMail}${randomInt(5)}@gmail.com`;
      const proxy = await getAvailableProxy();
      const success = await register(email, ctx.session.password, ctx.session.referralCode, proxy);
      await safeTelegramCall(
        ctx,
        () => ctx.reply(`[${i}] اکانت ${email}: ${success ? 'ثبت شد' : 'ناموفق'}`, {
          reply_markup: {
            inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
          }
        }),
        'Error replying to register'
      );
      await new Promise(resolve => setTimeout(resolve, 1000)); // تاخیر بین اکانت‌ها
    }
    ctx.session.waitingForLoop = false;
    delete ctx.session.referralCode;
    delete ctx.session.nameMail;
    delete ctx.session.password;
    return;
  }
});

// نمایش و مدیریت اکانت‌ها
bot.action('list_accounts', async (ctx) => {
  const accounts = await readAccounts();
  if (accounts.length === 0) {
    await safeTelegramCall(
      ctx,
      () => ctx.reply('هیچ اکانتی وجود ندارد.', {
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error replying to list_accounts'
    );
    return;
  }
  const keyboard = accounts.map((acc, index) => [{ text: `${acc.email} (${acc.proxy || 'بدون پراکسی'})`, callback_data: `delete_${index}` }]);
  keyboard.push([{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]);
  await safeTelegramCall(
    ctx,
    () => ctx.reply('لیست اکانت‌ها:', { reply_markup: { inline_keyboard: keyboard } }),
    'Error sending account list'
  );
});

bot.action(/^delete_(\d+)$/, async (ctx) => {
  const index = parseInt(ctx.match[1]);
  const accounts = await readAccounts();
  const deleted = accounts.splice(index, 1);
  await fs.writeFile('accounts.json', JSON.stringify(accounts, null, 4));
  await safeTelegramCall(
    ctx,
    () => ctx.reply(`اکانت ${deleted[0].email} حذف شد.`, {
      reply_markup: {
        inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
      }
    }),
    'Error replying to delete'
  );
});

// اضافه کردن اکانت
bot.action('add_account', (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.waitingForEmail = true;
  safeTelegramCall(
    ctx,
    () => ctx.reply('ایمیل اکانت را وارد کنید:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
      }
    }),
    'Error sending add_account prompt'
  );
});

// انتخاب اکانت برای تسک‌ها
bot.action('do_tasks', async (ctx) => {
  const accounts = await readAccounts();
  if (accounts.length === 0) {
    await safeTelegramCall(
      ctx,
      () => ctx.reply('هیچ اکانتی وجود ندارد.', {
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error replying to do_tasks'
    );
    return;
  }
  ctx.session = ctx.session || {};
  ctx.session.waitingForAccount = true;
  const keyboard = accounts.map((acc, index) => [{ text: acc.email, callback_data: `select_account_${index}` }]);
  keyboard.push([{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]);
  await safeTelegramCall(
    ctx,
    () => ctx.reply('لطفاً اکانت مورد نظر را انتخاب کنید:', {
      reply_markup: { inline_keyboard: keyboard }
    }),
    'Error sending account selection'
  );
});

bot.action(/^select_account_(\d+)$/, async (ctx) => {
  if (!ctx.session || !ctx.session.waitingForAccount) return;
  const index = parseInt(ctx.match[1]);
  const accounts = await readAccounts();
  const account = accounts[index];
  if (!account) {
    await safeTelegramCall(
      ctx,
      () => ctx.reply('اکانت نامعتبر است.', {
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error replying to invalid account'
    );
    ctx.session.waitingForAccount = false;
    return;
  }

  await safeTelegramCall(
    ctx,
    () => ctx.reply(`شروع انجام تسک‌ها برای ${account.email}...`),
    'Error sending task start message'
  );
  let results = `<b>📋 گزارش انجام تسک‌ها</b>\n<i>آخرین آپدیت: ${new Date().toLocaleString('fa-IR')}</i>\n\n`;
  let accountResult = `<b>🟢 ${account.email}</b>\nپراکسی: ${account.proxy || 'بدون پراکسی'}\n`;
  const proxy = account.proxy;
  console.log(`Processing account ${account.email} with proxy ${proxy || 'none'}`);

  let token;
  try {
    token = await login(account.email, account.password, proxy);
  } catch (e) {
    console.log(`Login error for ${account.email}: ${e.message}`);
    accountResult += `وضعیت: ورود ناموفق (${e.message})\n\n`;
    results += accountResult;
    await safeTelegramCall(
      ctx,
      () => ctx.reply(results, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error sending login error'
    );
    ctx.session.waitingForAccount = false;
    return;
  }

  if (!token) {
    accountResult += 'وضعیت: ورود ناموفق\n\n';
    results += accountResult;
    await safeTelegramCall(
      ctx,
      () => ctx.reply(results, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error sending login failure'
    );
    ctx.session.waitingForAccount = false;
    return;
  }

  let tasks;
  try {
    tasks = await getTasks(token, proxy);
  } catch (e) {
    console.log(`Get tasks error for ${account.email}: ${e.message}`);
    accountResult += `وضعیت: خطا در گرفتن تسک‌ها (${e.message})\n\n`;
    results += accountResult;
    await safeTelegramCall(
      ctx,
      () => ctx.reply(results, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error sending tasks error'
    );
    ctx.session.waitingForAccount = false;
    return;
  }

  let taskCount = 0;
  for (const task of tasks) {
    try {
      const taskResult = await doTask(token, task._id, proxy);
      const claimResult = await claimTask(token, task._id, proxy);
      accountResult += `تسک ${task._id}: ${taskResult?.result === 'success' ? 'موفق' : 'ناموفق'}\n` +
                      `Claim: ${claimResult?.result === 'success' ? 'موفق' : 'ناموفق'}\n`;
      taskCount++;
    } catch (e) {
      console.log(`Error in task ${task._id} for ${account.email}: ${e.message}`);
      accountResult += `تسک ${task._id}: خطا (${e.message})\nClaim: ناموفق\n`;
    }
    await new Promise(resolve => setTimeout(resolve, 2000)); // تاخیر 2 ثانیه بین تسک‌ها
  }

  let points;
  try {
    points = await getPoint(token, proxy);
  } catch (e) {
    console.log(`Get point error for ${account.email}: ${e.message}`);
    points = 'نامشخص';
  }

  accountResult += `پوینت: ${points || 'نامشخص'}\nتسک‌های انجام‌شده: ${taskCount}\n\n`;
  results += accountResult;

  await safeTelegramCall(
    ctx,
    () => ctx.reply(results, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
      }
    }),
    'Error sending task results'
  );
  ctx.session.waitingForAccount = false;
});

// ماینینگ
bot.action('mining', async (ctx) => {
  if (isMining) {
    await safeTelegramCall(
      ctx,
      () => ctx.reply('ماینینگ در حال اجراست.', {
        reply_markup: {
          inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
        }
      }),
      'Error replying to mining running'
    );
    return;
  }
  isMining = true;
  await safeTelegramCall(
    ctx,
    () => ctx.reply('ماینینگ شروع شد. گزارش هر 1 دقیقه آپدیت می‌شود.', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Stop', callback_data: 'stop' }]]
      }
    }),
    'Error sending mining start'
  );
  const accounts = await readAccounts();
  let lastMessageId = null;

  miningInterval = setInterval(async () => {
    if (stopRequested) {
      clearInterval(miningInterval);
      isMining = false;
      stopRequested = false;
      await safeTelegramCall(
        ctx,
        () => ctx.telegram.sendMessage(ctx.chat.id, 'ماینینگ متوقف شد.', {
          reply_markup: {
            inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
          }
        }),
        'Error sending mining stop'
      );
      return;
    }

    let message = '<b>📊 گزارش ماینینگ</b>\n';
    message += `<i>آخرین آپدیت: ${new Date().toLocaleString('fa-IR')}</i>\n\n`;
    for (const account of accounts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // تاخیر بین اکانت‌ها
      try {
        const proxy = account.proxy;
        console.log(`Checking account ${account.email} with proxy ${proxy || 'none'}`);
        let token;
        const cached = tokenCache.get(account.email);
        if (cached && cached.expiresAt > Date.now()) {
          console.log(`Using cached token for ${account.email}`);
          token = cached.token;
        } else {
          token = await login(account.email, account.password, proxy);
          if (!token) {
            message += `<b>🔴 ${account.email}</b>\n` +
                      `وضعیت: ورود ناموفق\n` +
                      `پراکسی: ${proxy || 'بدون پراکسی'}\n\n`;
            continue;
          }
        }

        const startTime = Date.now();
        let points;
        try {
          points = await getPoint(token, proxy);
        } catch (e) {
          if (e.response?.status === 401) { // توکن منقضی شده
            console.log(`Token expired for ${account.email}, re-logging in`);
            tokenCache.delete(account.email);
            token = await login(account.email, account.password, proxy);
            if (token) {
              points = await getPoint(token, proxy);
            } else {
              message += `<b>🔴 ${account.email}</b>\n` +
                        `وضعیت: ورود ناموفق پس از تلاش مجدد\n` +
                        `پراکسی: ${proxy || 'بدون پراکسی'}\n\n`;
              continue;
            }
          } else {
            console.log(`Error getting points for ${account.email}: ${e.message}`);
            points = 'نامشخص';
          }
        }
        const latency = Date.now() - startTime;
        message += `<b>🟢 ${account.email}</b>\n` +
                  `پوینت: ${points || 'نامشخص'}\n` +
                  `تأخیر: ${latency}ms\n` +
                  `پراکسی: ${proxy || 'بدون پراکسی'}\n\n`;
      } catch (e) {
        console.log(`Error processing account ${account.email}: ${e.message}`);
        message += `<b>🔴 ${account.email}</b>\n` +
                  `وضعیت: خطا (${e.message})\n` +
                  `پراکسی: ${account.proxy || 'بدون پراکسی'}\n\n`;
      }
    }

    if (lastMessageId) {
      const success = await safeTelegramCall(
        ctx,
        () => ctx.telegram.editMessageText(ctx.chat.id, lastMessageId, null, message, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: 'Stop', callback_data: 'stop' }]]
          }
        }),
        'Error editing mining message'
      );
      if (!success) lastMessageId = null;
    }
    if (!lastMessageId) {
      const success = await safeTelegramCall(
        ctx,
        async () => {
          const sentMessage = await ctx.telegram.sendMessage(ctx.chat.id, message, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: 'Stop', callback_data: 'stop' }]]
            }
          });
          lastMessageId = sentMessage.message_id;
        },
        'Error sending mining message'
      );
      if (!success) return;
    }
  }, 60000); // هر 1 دقیقه
});

// توقف
bot.action('stop', (ctx) => {
  stopRequested = true;
  safeTelegramCall(
    ctx,
    () => ctx.reply('درخواست توقف ارسال شد...', {
      reply_markup: {
        inline_keyboard: [[{ text: 'بازگشت به خانه', callback_data: 'back_to_home' }]]
      }
    }),
    'Error sending stop message'
  );
});

// شروع بات
bot.launch();
console.log('Bot is running...');

// مدیریت خروج
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
