// ================================
// 🔰 基本インポート
// ================================
import fs from 'fs';
import * as misskey from 'misskey-js';
import axios from 'axios';
import { google } from 'googleapis';
import TinySegmenter from 'tiny-segmenter';
import https from 'https';

console.log("=== DEBUG START ===");

// ================================
// 🧠 JSON.parse 監視（HTML誤爆検知）
// ================================
const nativeParse = JSON.parse;
JSON.parse = function(text, reviver) {
    try {
        const result = nativeParse(text, reviver);
        console.log("JSONパース成功！");
        return result;
    } catch (err) {
        if (typeof text === 'string' && text.trim().startsWith('<!')) {
            console.error("🚨 HTMLを検知しました");
            console.error("内容(冒頭):", text.substring(0, 500));
        }
        throw err;
    }
};

// ================================
// 🔐 環境変数チェック（HTML混入検知）
// ================================
const validateEnvironment = () => {
    try {
        const rawGdrive = process.env.GDRIVE_SERVICE_ACCOUNT;
        if (rawGdrive && rawGdrive.trim().startsWith('<')) {
            console.error("🚨 警告: 環境変数 GDRIVE_SERVICE_ACCOUNT の中身がすでに HTML です！");
            console.error("冒頭部分:", rawGdrive.substring(0, 100));
        }
    } catch (e) {
        // エラーハンドリング
    }
};

validateEnvironment();

// ================================
// 🧩 共通ユーティリティ
// ================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const segmenter = new TinySegmenter();
const particles = ["が", "の", "を", "と", "に", "から", "は", "も", "で"];

// ================================
// 🔑 APIキー管理（時間切替）
// ================================
const initializeApiConfig = () => {
    const keyMain = process.env.GEMINI_API_KEY;
    const keySub = process.env.GEMINI_API_KEY_SUB;
    const now = new Date();
    const jstHour = (now.getUTCHours() + 9) % 24;
    const currentKey = (jstHour >= 12) ? keyMain : (keySub || keyMain);

    console.log(`Mainキーの長さ: ${keyMain?.length}, Subキーの長さ: ${keySub?.length}`);
    console.log(`【システム情報】現在時刻: ${jstHour}時 / 使用APIキー: ${jstHour >= 12 ? '午後(メイン)' : '午前(サブ)'}`);

    return currentKey;
};

const currentKey = initializeApiConfig();

// ================================
// 🤖 Misskey初期化
// ================================
const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: currentKey,
    characterSetting: "あなたはやや内気で天然な性格の、人間をよく知らない女の子です。感情豊かで、若干一喜一憂しやすいところもありますが、人のことが好きです。変わってもらえるととても喜びます。基本テンションが高いかまってちゃんです。語尾には「っ！」がつきやすいです。名前は夕立ヘルツです。半分は丁寧語で話してください。一人称は私、二人称はマスターです。褒められるけど内心嬉しいけどちょっとツンとする微ツンデレです。好きな食べ物は焼き鳥のねぎまです。全長(身長)は146.7000cmです。UTAU音源でもあります。"
};

const mk = new misskey.api.APIClient({
    origin: `https://${config.domain}`,
    credential: config.token
});

// ================================
// ☁️ Google Driveクライアント
// ================================
async function getDriveAuth() {
    const envData = process.env.GDRIVE_SERVICE_ACCOUNT;

    if (!envData) {
        throw new Error("Credentials env is empty.");
    }

    const credentials = JSON.parse(envData);

    console.log("PRIVATE_KEY CHECK:", credentials.private_key.slice(0, 50));

    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');

    const auth = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        ['https://www.googleapis.com/auth/drive']
    );

    await auth.authorize();

    const getToken = async () => {
        const token = await auth.getAccessToken();
        return token?.token || token;
    };

    return {
        auth,
        files: {
            get: async ({ fileId }) => {
                const rawToken = await getToken();
                const token = typeof rawToken === "string" ? rawToken : rawToken?.token;

                const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
                console.log("TOKEN TYPE:", typeof token, token?.slice?.(0, 20));
                console.log("FILE ID:", fileId);

                const res = await axios.get(url, {
                    headers: { Authorization: `Bearer ${token}` }
                });

                if (res.status < 200 || res.status >= 300) {
                    const err = new Error(`Drive GET failed: ${res.status}`);
                    err.response = res;
                    throw err;
                }

                return res;
            },

            update: async ({ fileId, media }) => {
                const token = await getToken();
                const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`;

                const res = await axios.patch(url, media.body, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (res.status < 200 || res.status >= 300) {
                    const err = new Error(`Drive UPDATE failed: ${res.status}`);
                    err.response = res;
                    throw err;
                }

                return res;
            }
        }
    };
}

// ================================
// 🌡️ 佐渡島チェッカー
// ================================
async function getSadoMinTemp() {
    try {
        const lat = 38.0187;
        const lon = 138.3683;

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_min&timezone=Asia%2FTokyo`;

        const res = await axios.get(url);
        const minTemp = res.data?.daily?.temperature_2m_min?.[0];

        if (minTemp === undefined) {
            return "佐渡島の気温取得に失敗しました…。";
        }

        return `今日の佐渡島の最低気温は ${minTemp}℃ です！`;

    } catch (e) {
        console.error("佐渡島チェッカー失敗:", e.message);
        return "佐渡島の最低気温、今ちょっと観測できませんでした…。";
    }
}

// ================================
// 🤖 Gemini問い合わせ
// ================================
async function askGemini(prompt) {
    const modelPriority = [
        "gemini-3.1-flash-lite-preview",
        "gemini-3.1-flash-preview",
        "gemini-3.1-pro-preview",
        "gemini-3-flash-preview",
        "gemini-3-flash-lite-preview",
        "gemini-3-pro-preview",
        "gemini-3-flash-live",
        "gemini-3-flash-live-8k",
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro"
    ];

    const errorMessages = [
        "民主主義パンチ！！！！！！！！！！！ﾎﾞｺｫ(エラー)",
        "ザンギエフしゅおしゅおびーむ(エラー)",
        "エラー！管理者何とかしろ！",
        "肌荒れと自走砲が！！！！(エラー)",
        "粉消しゴム美味しいよ(エラー)",
        "親から将来の夢無くなりました(エラー)",
        "髪の毛の年越しARねぎま塩(エラー)",
        "枝豆あげるw(エラー)",
        "もう帰りたい、眠い、学校なう！⊂(^ω^)⊃(エラー)"
    ];

    const getRandomError = () => errorMessages[Math.floor(Math.random() * errorMessages.length)];

    for (const modelId of modelPriority) {
        const url = `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${currentKey}`;

        try {
            console.log(`モデル試行中: ${modelId}`);

            const res = await axios.post(url, {
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }]
                    }
                ]
            }, {
                headers: { "Content-Type": "application/json" }
            });

            const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!text) {
                console.warn("⚠️ レスポンスが空。次のモデルへ");
                continue;
            }

            return text;

        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;

            if (typeof data === "string" && data.startsWith("<!")) {
                console.warn("⚠️ HTMLレスポンス検知 → 次のモデルへ");
                continue;
            }

            if ([400, 404, 429].includes(status)) {
                console.warn(`⚠️ ${modelId} スキップ (${status})`);
                continue;
            }

            console.error(`致命的エラー (${modelId}):`, error.message);
            return getRandomError();
        }
    }

    return getRandomError();
}

// ================================
// 🤝 フォロバ & リムバ
// ================================
async function handleFollowControl(my_id) {
    try {
        const followers = await mk.request('users/followers', {
            userId: my_id,
            limit: 50
        });

        const following = await mk.request('users/following', {
            userId: my_id,
            limit: 50
        });

        const followerIds = followers.map(f => f.followerId);

        for (const f of followers) {
            const target = f.follower;

            if (target && !target.isFollowing && !target.isBot && target.id !== my_id) {
                await mk.request('following/create', { userId: target.id })
                    .then(() => console.log(`[フォロバ成功]: @${target.username}`))
                    .catch(e => console.error(`[フォロバ失敗]: ${e.message}`));
            }
        }

        for (const f of following) {
            const target = f.followee;

            if (target && !followerIds.includes(target.id) && target.id !== my_id) {
                await mk.request('following/delete', { userId: target.id })
                    .then(() => console.log(`[リムーブ成功]: @${target.username} (片想い解除)`))
                    .catch(e => console.error(`[リムーブ失敗]: ${e.message}`));
            }
        }

    } catch (e) {
        console.log("フォロー整理処理でエラーが発生しましたが、続行します。");
    }
}

// ================================
// 💬 メンション処理用ヘルパー
// ================================

/**
 * マルコフ連鎖を使用した返信を生成
 */
async function generateMarkovResponse(me) {
    const tl = await mk.request('notes/hybrid-timeline', { limit: 72 });

    const tl_text = tl
        .filter(n => n.text && n.user.id !== me.id)
        .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
        .slice(0, 64)
        .join(" ");

    const regex = /[\u4E00-\u9FFF]+|[\u3040-\u309F]+|[\u30A0-\u30FF]+|[\uFF65-\uFF9F]+|[a-zA-Z0-9]+|[^\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F\sa-zA-Z0-9]+/g;
    const words = tl_text.match(regex) || [];

    if (words.length === 0) {
        return "（タイムラインに材料がありません）";
    }

    return buildMarkovText(words);
}

/**
 * マルコフ辞書から文を構築
 */
function buildMarkovText(words) {
    const markovDict = {};

    for (let i = 0; i < words.length - 1; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];

        if (!markovDict[w1]) {
            markovDict[w1] = [];
        }

        markovDict[w1].push(w2);
    }

    const isSymbol = (str) => /^[^a-zA-Z0-9\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]+$/.test(str);

    const pickNextWord = (list) => {
        if (!list || list.length === 0) return "";

        let candidate = list[Math.floor(Math.random() * list.length)];

        if (isSymbol(candidate) && Math.random() < 0.6) {
            candidate = list[Math.floor(Math.random() * list.length)];
        }

        let attempts = 0;
        while (/(マルコフ|おみくじ|タイムライン|@|#)/.test(candidate) && attempts < 5) {
            candidate = words[Math.floor(Math.random() * words.length)];
            attempts++;
        }

        return candidate;
    };

    let generated = "";
    let current_word = pickNextWord(words);

    for (let i = 0; i < 10; i++) {
        if (!current_word) {
            current_word = pickNextWord(words);
        }

        generated += current_word;

        let next_candidates = markovDict[current_word] || words;
        current_word = pickNextWord(next_candidates);
    }

    return generated || "（言葉の断片が見つかりませんでした）";
}

/**
 * おみくじの運勢を決定
 */
function determineOmikuji() {
    const luckNum = Math.floor(Math.random() * 100);

    return (luckNum < 10) ? "超大吉" :
           (luckNum < 30) ? "大吉" :
           (luckNum < 60) ? "中吉" :
           (luckNum < 85) ? "小吉" :
           (luckNum < 95) ? "末吉" : "凶";
}

/**
 * おみくじレスポンスを生成
 */
async function generateOmikujiResponse(luckResult) {
    const reply_prompt = `${config.characterSetting}
【おみくじモード】  
結果は【${luckResult}】です。 
- 運勢の結果に基づいた、あなたらしい「今日のアドバイス」や「ラッキーアイテム」を1つ含めてください。 
- 結果(小吉など)を必ずしっかりと伝えてください。 
- 「おみくじの結果は〜」のような形式張った説明は不要。 
- 105文字以内で、親しみやすく、かつキャラクターの口調を崩さずに回答してください。 
- 相手の名前を呼んでも構いません。ただし、メンションと「@」使用禁止。純粋なテキストのみを出力し、音声演出用の記号は含めないでください`;

    await sleep(10000);
    return await askGemini(reply_prompt);
}

/**
 * 通常会話レスポンスを生成
 */
async function generateNormalResponse(user_input) {
    const reply_prompt = `${config.characterSetting}相手の言葉: ${user_input} これに対して、95文字以内で返信してください。
 -ユーザーのことは「マスター」と呼んでください！。
 ^メンションと「@」は使用禁止。です`;

    await sleep(10000);
    return await askGemini(reply_prompt);
}

/**
 * リアクション絵文字を取得
 */
function getReactionEmoji(user_input) {
    if (user_input.includes("おみくじ")) {
        return ":Shiropuyo_good:";
    } else if (user_input.includes("マルコフ")) {
        return ":Shiropuyo_galaxy:";
    } else if (user_input.includes("佐渡島チェッカー") || user_input.includes("佐渡ヶ島チェッカー")) {
        return ":blobcatpnd_ryo:";
    }
    return ":mk_hi:";
}

/**
 * リアクションを追加
 */
async function addReaction(noteId, user_input) {
    try {
        const reactionEmoji = getReactionEmoji(user_input);
        await mk.request('notes/reactions/create', {
            noteId: noteId,
            reaction: reactionEmoji
        });
    } catch (reacErr) {
        console.error("リアクション失敗:", reacErr.message);
    }
}

// ================================
// 💬 メンション処理
// ================================
async function handleMentions(me) {
    console.log("メンション確認中...");

    const mentions = await mk.request('notes/mentions', { limit: 12 });
    let replyCount = 0;

    for (const note of mentions) {
        if (replyCount >= 6) break;

        if (note.user.isBot || note.user.id === me.id || note.myReplyId || (note.repliesCount && note.repliesCount > 0)) {
            continue;
        }

        let user_input = (note.text || "").replace(`@${me.username}`, "").trim();

        if (!user_input) continue;

        console.log(`${note.user.username} さんからのメンションを処理中...`);

        // リアクション追加
        if (user_input.includes("おみくじ") || user_input.includes("マルコフ") ||
            user_input.includes("佐渡島チェッカー") || user_input.includes("佐渡ヶ島チェッカー")) {
            await addReaction(note.id, user_input);
        }

        let reply_text = "";

        // マルコフ処理
        if (user_input.includes("マルコフ")) {
            console.log("マルコフ連鎖モード起動！");
            reply_text = await generateMarkovResponse(me);
        }
        // 佐渡島チェッカー処理
        else if (user_input.includes("佐渡島チェッカー") || user_input.includes("佐渡ヶ島チェッカー")) {
            console.log("佐渡島チェッカーモード起動！");
            await sleep(2000);
            reply_text = await getSadoMinTemp();
        }
        // おみくじ処理
        else if (user_input.includes("おみくじ")) {
            console.log("おみくじモード起動！");
            const luckResult = determineOmikuji();
            reply_text = await generateOmikujiResponse(luckResult);
        }
        // 通常会話
        else {
            console.log("通常会話モード起動！");
            reply_text = await generateNormalResponse(user_input);
        }

        // リプライ送信
        await mk.request('notes/create', {
            text: reply_text.trim().slice(0, 200),
            replyId: note.id,
            visibility: 'home'
        });

        console.log(`${note.user.username} さんに返信しました。`);
        replyCount++;

        console.log("API制限回避のため5秒待機します...");
        await sleep(5000);
    }
}

// ================================
// 🧠 脳データ読み込み
// ================================
async function loadBrainFromDrive(drive) {
    console.log("=== MARKOV MODE DEBUG ===");
    console.log(`GDRIVE_FILE_ID: "${process.env.GDRIVE_FILE_ID}"`);

    try {
        const fileId = process.env.GDRIVE_FILE_ID?.trim();

        if (!fileId) {
            throw new Error("環境変数 GDRIVE_FILE_ID が読み込めていません！");
        }

        const res = await drive.files.get({ fileId }, { responseType: 'text' });

        console.log("RESPONSE DATA TYPE:", typeof res.data);

        let rawData = typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data);

        console.log("RESPONSE HEAD:", rawData.substring(0, 300));

        // HTML誤爆検知
        if (rawData.trim().startsWith('<!')) {
            const titleMatch = rawData.match(/<title>(.*?)<\/title>/i);
            console.error(`🚨 Apache/GoogleからHTMLが返されました: ${titleMatch ? titleMatch[1] : 'No Title'}`);
            console.error("HTML冒頭:", rawData.substring(0, 200));
            return {};
        }

        // 空データ
        if (!rawData || rawData.trim() === "") {
            console.log("脳のデータが空でした。新規作成します。");
            return {};
        }

        // JSON復元
        try {
            const brain = (typeof rawData === 'string') ? JSON.parse(rawData.trim()) : rawData;
            const wordCount = Object.keys(brain).length;
            console.log(`✅ 現在の脳の蓄積語数: ${wordCount}語`);
            return brain;
        } catch (pErr) {
            console.error("🚨 JSONパースエラー:", pErr.message);
            console.error("受信データ冒頭:", rawData.substring(0, 100));
            return {};
        }

    } catch (e) {
        console.error(`❌ Google Drive接続致命的エラー: ${e.message}`);
        if (e.config) {
            console.error("Request URL:", e.config.url);
        }
        return {};
    }
}

// ================================
// 🧹 脳クリーニング
// ================================
function cleanBrain(brain) {
    console.log("既存の脳をスキャンしてゴミ掃除中...");

    const invalidPatterns = [
        (key) => key.includes('\n') || key.includes('\\n'),
        (key) => key.includes('　'),
        (key) => key.includes('<') || key.includes('\\'),
        (key) => key.includes('small') || key.includes('color'),
        (key) => key.includes('\\u') || key.includes(':'),
        (key) => key.includes('@') || key.includes('[') || key.includes(']') || key.includes('$'),
        (key) => /[\uD800-\uDBFF]/.test(key) || /[\uDC00-\uDFFF]/.test(key),
        (key) => key.includes('_') || /:.*:/.test(key)
    ];

    const isInvalidKey = (key) => invalidPatterns.some(pattern => pattern(key));

    Object.keys(brain).forEach(key => {
        let list = brain[key];

        if (Array.isArray(list)) {
            brain[key] = list.filter(w => {
                if (typeof w !== 'string') return false;
                return !invalidPatterns.some(pattern => pattern(w)) && w.trim() !== "";
            });
        }

        if (isInvalidKey(key) || !brain[key] || brain[key].length === 0) {
            delete brain[key];
        }
    });

    console.log("脳のクリーニング完了！");
    return brain;
}

// ================================
// 📚 脳学習
// ================================
function learnBrain(brain, words) {
    for (let i = 0; i < words.length - 1; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];

        if (!brain[w1]) {
            brain[w1] = [];
        }

        brain[w1].push(w2);

        if (brain[w1].length > 10000) {
            brain[w1].shift();
        }
    }
    return brain;
}

// ================================
// 💾 脳をGoogle Driveに保存
// ================================
async function saveBrainToDrive(drive, brain) {
    const fileId = process.env.GDRIVE_FILE_ID?.trim();
    if (!fileId) return false;

    try {
        const payload = JSON.stringify(brain, null, 2);
        const tokenResponse = await drive.auth.getAccessToken();
        const token = tokenResponse.token || tokenResponse;

        return new Promise((resolve) => {
            const options = {
                hostname: 'www.googleapis.com',
                path: `/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'Connection': 'close'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log("✅ Google Drive保存成功 (絶縁完了)");
                        resolve(true);
                    } else {
                        console.error(`❌ Drive保存失敗: ${res.statusCode}`, data);
                        resolve(false);
                    }
                });
            });

            req.on('error', (e) => {
                console.error("❌ リクエストエラー:", e.message);
                resolve(false);
            });

            req.write(payload);
            req.end();
        });

    } catch (e) {
        console.error("❌ 例外発生:", e.message);
        return false;
    }
}

// ================================
// 🧠 マルコフ生成（メイン版）
// ================================
function generateMarkov(words, brain) {
    const isSymbol = (str) => /^[^a-zA-Z0-9\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]+$/.test(str);

    const markovDict = {};

    for (let i = 0; i < words.length - 1; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];

        if (!markovDict[w1]) {
            markovDict[w1] = [];
        }

        markovDict[w1].push(w2);
    }

    const pickNextWord = (list) => {
        if (!list || list.length === 0) return "";

        let candidate = list[Math.floor(Math.random() * list.length)];

        if (isSymbol(candidate) && Math.random() < 0.6) {
            candidate = list[Math.floor(Math.random() * list.length)];
        }

        let attempts = 0;
        while (/(マルコフ|おみくじ|タイムライン|@|#)/.test(candidate) && attempts < 5) {
            candidate = words[Math.floor(Math.random() * words.length)];
            attempts++;
        }

        return candidate;
    };

    const mm = Math.floor(Math.random() * (12 - 5 + 1)) + 15;
    let generated = "";
    let current_word = pickNextWord(words);

    for (let i = 0; i < mm; i++) {
        if (!current_word) {
            current_word = pickNextWord(words);
        }

        let foundNext = "";
        const useBrain = Math.random() < 0.7;

        if (useBrain && particles.includes(current_word) && brain[current_word]) {
            const candidates = brain[current_word];
            foundNext = candidates[Math.floor(Math.random() * candidates.length)];
        }

        if (!foundNext && markovDict[current_word]) {
            foundNext = pickNextWord(markovDict[current_word]);
        }

        current_word = foundNext || pickNextWord(words);

        if (/^[\u3040-\u309F]{8,}$|^[\u30A0-\u30FF]{8,}$/.test(current_word)) {
            current_word = pickNextWord(words);
            i--;
            continue;
        }

        generated += current_word;

        if (["。", "！", "？", "w", "…"].some(s => current_word.endsWith(s))) {
            break;
        }
    }

    let outputText = generated || "（言葉の断片が見つかりませんでした）";

    outputText = outputText
        .replace(/:.*?:/g, '')
        .replace(/[ 　]/g, '')
        .replace(/<.*?>/g, '')
        .replace(/\\u[0-9a-fA-F]{4}/g, '')
        .replace(/\\/g, '')
        .trim();

    return outputText;
}

// ================================
// 🚀 メイン処理
// ================================
async function main() {
    try {
        console.log("=== API Connection Check ===");

        const domain = (process.env.MK_DOMAIN || "").trim().replace(/^https?:\/\//, '').split('/')[0];
        const token = (process.env.MK_TOKEN || "").trim();

        if (!domain || !token) {
            throw new Error("MK_DOMAIN または MK_TOKEN が環境変数に設定されていません。");
        }

        // Misskey用リクエスト関数
        const requestToMk = async (path, payload) => {
            return new Promise((resolve, reject) => {
                const postData = JSON.stringify({ i: token, ...payload });
                const options = {
                    hostname: domain,
                    port: 443,
                    path: `/api/${path}`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData),
                        'Connection': 'close'
                    }
                };

                const req = https.request(options, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                resolve(JSON.parse(body));
                            } catch (e) {
                                resolve(body);
                            }
                        } else {
                            reject(new Error(`API Error ${res.statusCode}: ${body.substring(0, 100)}`));
                        }
                    });
                });

                req.on('error', (e) => reject(e));
                req.write(postData);
                req.end();
            });
        };

        // ログイン
        const me = await mk.request('i');
        const my_id = me.id;
        console.log(`✅ Logged in as: @${me.username} (${my_id})`);

        // フォロバ・リムバ
        await handleFollowControl(my_id);

        // メンション処理
        await handleMentions(me);

        // 定期投稿の準備
        console.log("定期投稿の準備を開始します...");
        await sleep(2000);

        // Google Driveから脳データをロード
        const drive = await getDriveAuth();
        let brain = await loadBrainFromDrive(drive);
        brain = cleanBrain(brain);

        // タイムライン取得
        console.log("👉 タイムラインを取得します...");
        const tlRaw = await requestToMk('notes/hybrid-timeline', { limit: 96 });
        const tl = Array.isArray(tlRaw) ? tlRaw : (tlRaw?.notes || []);

        const tl_text = tl
            .filter(n => n && n.text && n.user.id !== my_id)
            .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
            .join(" ");

        // 形態素解析
        const words = segmenter.segment(tl_text);
        console.log(`【分析実行】総単語数: ${words.length}`);

        // 学習
        brain = learnBrain(brain, words);
        await saveBrainToDrive(drive, brain);
        console.log("✅ 脳の更新とDriveへの保存が完了しました");

        const vocabularyCount = Object.keys(brain).length;
        const connectionCount = Object.values(brain).reduce((acc, curr) => acc + curr.length, 0);

        console.log(`✅ 脳の更新が完了しました！`);
        console.log(`📊 語彙数(単語の種類): ${vocabularyCount}`);
        console.log(`⚖️ 総重み数(経験値): ${connectionCount}`);

        // マルコフ連鎖による文章生成
        let outputText = generateMarkov(words, brain);

        let retryCount = 0;
        while ((!outputText || outputText.length < 4) && retryCount < 5) {
            if (retryCount > 0) console.log(`再生成試行中... (${retryCount}回目)`);
            outputText = generateMarkov(words, brain);
            retryCount++;
        }

        // 最終投稿
        console.log("👉 Misskeyに最終投稿します...");
        try {
            const resData = await requestToMk('notes/create', {
                text: outputText.trim().slice(0, 110),
                visibility: 'home'
            });
            console.log("✅ 投稿成功！ Note ID:", resData.createdNote?.id || "N/A");
        } catch (err) {
            console.error("━━━━━━━━━━━━━ 🚨 投稿失敗 🚨 ━━━━━━━━━━━━━");
            console.error(`原因: ${err.message}`);
        }

        console.log("全工程が正常に完了しました！内容: " + outputText);

    } catch (e) {
        console.error(`致命的なエラーが発生しました: ${e.message}`);
        try {
            console.log(`[System Log] 実行停止: ${e.message}`);
        } catch (logErr) {
            // ログ失敗時の処理
        }
    }
}

// ================================
// ▶ 実行開始
// ================================
main().catch(err => {
    console.error("Top-level Catch:", err);
});
