import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { gzipSync } from 'zlib';

const hdRepoPath = resolve('./output/userresult.m3u');
const mivgoUrl = 'http://raw.githubusercontent.com/develop202/migu_video/refs/heads/main/interface.txt';
const m3uOutputPath = resolve('./IPV4.m3u');
const gzOutputPath = resolve('./channels.gz');

// 标准化频道名称，用于匹配
function normalizeChannelName(name) {
    // 处理 CCTV 频道（支持 CCTV1、CCTV1+、CCTV1综合 等格式）
    const cctvMatch = name.match(/^CCTV(\d+[+]?)/);
    if (cctvMatch) {
        return `CCTV-${cctvMatch[1]}`;
    }
    // 处理其他频道（如卫视）
    return name;
}

function parseM3U(content) {
    const lines = content.split('\n');
    const header = [];
    const channels = [];

    let i = 0;

    // 读取头部
    while (i < lines.length && (lines[i].startsWith('#EXTM3U') || lines[i].startsWith('#EXT-X-'))) {
        header.push(lines[i]);
        i++;
    }

    // 读取频道
    while (i < lines.length) {
        const line = lines[i];

        if (!line.startsWith('#EXTINF')) {
            i++;
            continue;
        }

        const groupMatch = line.match(/group-title="([^"]+)"/);
        const displayNameMatch = line.match(/,([^,\n]+)$/);

        const displayName = displayNameMatch ? displayNameMatch[1] : '';
        const group = groupMatch ? groupMatch[1] : '';

        // 使用标准化的显示名称作为匹配键
        const nameKey = normalizeChannelName(displayName);

        channels.push({
            group,
            name: displayName,
            nameKey: nameKey,
            extinf: line,
            url: lines[i + 1] || ''
        });

        i += 2;
    }

    return { header, channels };
}

function buildM3U(header, channels) {
    const lines = [...header];

    for (const channel of channels) {
        lines.push(channel.extinf);
        lines.push(channel.url);
    }

    return lines.join('\n');
}

async function fetchContent(url) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.text();
}

async function main() {
    try {
        console.log('读取 HD 仓库文件...');
        const hdContent = readFileSync(hdRepoPath, 'utf-8');
        const hdData = parseM3U(hdContent);

        console.log('读取 mivgo.m3u 文件...');
        const mivgoContent = await fetchContent(mivgoUrl);
        const mivgoData = parseM3U(mivgoContent);

        const mivgoCCTVChannels = mivgoData.channels
            .filter(ch => ch.group === '央视频道')
            .reduce((acc, ch) => {
                if (!acc.has(ch.nameKey)) {
                    acc.set(ch.nameKey, []);
                }
                if (acc.get(ch.nameKey).length < 2) {
                    acc.get(ch.nameKey).push(ch);
                }
                return acc;
            }, new Map());

        const mivgoSatelliteChannels = mivgoData.channels
            .filter(ch => ch.group === '卫视频道')
            .reduce((acc, ch) => {
                if (!acc.has(ch.nameKey)) {
                    acc.set(ch.nameKey, []);
                }
                if (acc.get(ch.nameKey).length < 2) {
                    acc.get(ch.nameKey).push(ch);
                }
                return acc;
            }, new Map());

        console.log(`找到 ${mivgoCCTVChannels.size} 个央视频道`);
        console.log(`找到 ${mivgoSatelliteChannels.size} 个卫视频道`);

        console.log('mivgo 央视频道列表:', [...mivgoCCTVChannels.keys()]);
        console.log('HD 央视频道前5个:', hdData.channels
            .filter(ch => ch.group === '央视频道')
            .slice(0, 5)
            .map(ch => ({ name: ch.name, nameKey: ch.nameKey })));

        console.log('mivgo 卫视频道列表:', [...mivgoSatelliteChannels.keys()]);
        console.log('HD 卫视频道前5个:', hdData.channels
            .filter(ch => ch.group === '卫视频道')
            .slice(0, 5)
            .map(ch => ({ name: ch.name, nameKey: ch.nameKey })));

        const newChannels = [];
        const processedNames = new Set();

        let matchCount = 0;

        for (const channel of hdData.channels) {
            const key = channel.nameKey;
            const isCCTV = channel.group === '央视频道';
            const isSatellite = channel.group === '卫视频道';

            const mivgoChannels = isCCTV ? mivgoCCTVChannels : isSatellite ? mivgoSatelliteChannels : null;

            if (mivgoChannels && mivgoChannels.has(key) && !processedNames.has(key)) {
                const prependChannels = mivgoChannels.get(key);
                newChannels.push(...prependChannels);
                processedNames.add(key);
                matchCount++;
            }

            newChannels.push(channel);
        }

        console.log(`✓ 匹配并在前面添加了 ${matchCount} 个频道的 mivgo 源`);

        const outputContent = buildM3U(hdData.header, newChannels);
        writeFileSync(m3uOutputPath, outputContent, 'utf-8');

        const gzippedContent = gzipSync(outputContent, { level: 9 });
        writeFileSync(gzOutputPath, gzippedContent);

        console.log('✓ 处理完成，文件已保存到当前仓库:');
        console.log('  - IPV4.m3u:', m3uOutputPath);
        console.log('  - channels.gz:', gzOutputPath);
        console.log('✓ 原始频道数:', hdData.channels.length);
        console.log('✓ 更新后频道数:', newChannels.length);

    } catch (error) {
        console.error('✗ 处理失败:', error.message);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('✗ 处理失败:', error.message);
    process.exit(1);
});
