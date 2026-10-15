'use strict';

const cheerio = require('cheerio');
const { buildJavQueryAnchor } = require('../contracts/jav-source-contracts');

function clean(value, maximum = 4096) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maximum ? text : '';
}
function sameCode(actual, expected) {
  try { return buildJavQueryAnchor('jav_code', actual).javCode === expected; }
  catch { return false; }
}
function title(value, code) {
  const text = clean(value, 1024).replace(new RegExp('^' + code + '(?:\\s+|$)'), '').trim();
  return text && text !== code ? text : null;
}
function validDate(value) {
  const normalized = clean(value).replace(/\//g, '-');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number), date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
    ? match[1] + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') : null;
}
function document(bytes, contentType, fallbackEncoding = 'utf-8') {
  const charset = /charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(contentType || '')?.[1] || fallbackEncoding;
  if (!['utf-8', 'utf8', 'euc-jp', 'euc_jp', 'shift_jis', 'shift-jis'].includes(charset.toLowerCase()))
    throw Object.assign(new TypeError('JAV source charset is unsupported.'), { code: 'JAV_SOURCE_CHARSET_INVALID' });
  const html = new TextDecoder(charset).decode(bytes);
  return { html, $: cheerio.load(html) };
}
function javDbCandidates($, code) {
  const items = $('.movie-list .item');
  if (items.length > 100) return { result: 'response_invalid', resources: [] };
  const resources = [...new Set(items.toArray().filter(node => sameCode($(node).find('strong').first().text().trim(), code))
    .map(node => $(node).find('a').first().attr('href')).filter(value => /^\/v\/[A-Za-z0-9]{1,32}$/.test(value || '')))]
    .map(value => value.slice(3));
  return { result: resources.length > 1 ? 'ambiguous' : resources.length === 1 ? 'matched' : 'not_found', resources };
}
function parseJavSourcePage(siteRef, code, page, origin) {
  const { $, html } = page;
  let identityVerified = false, observedCode = null, displayTitle = null, cover = null, fields = {}, people = [], creditRole = null;
  const canonical = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content');
  if (siteRef === 'javdb') {
    const blocks = $('.movie-panel-info .panel-block'), value = label => blocks.toArray()
      .filter(node => clean($(node).find('strong').first().text()).replace(/[:：\s]/g, '') === label)
      .map(node => clean($(node).find('.value').text())).join(', ');
    observedCode = value('番號');
    identityVerified = sameCode(observedCode, code) && $('.video-detail').length === 1 && /^https:\/\/javdb\.com\/v\/[A-Za-z0-9]+$/.test(canonical || '');
    displayTitle = title($('h2.title').first().text(), code);
    cover = $('img.video-cover').first().attr('src');
    fields = { release_date: validDate(value('日期')), studio: value('片商'), genre: value('類別') };
    people = blocks.toArray().filter(node => clean($(node).find('strong').first().text()).replace(/[:：\s]/g, '') === '演員')
      .flatMap(node => $(node).find('.value a').toArray().map(actor => clean($(actor).text(), 256)));
    creditRole = 'studio';
  } else if (siteRef === 'javmenu') {
    const main = $('.col-md-9').filter((_, node) => $(node).find('h1.display-5').length === 1).first();
    const card = main.find('.left-wrapper > .card > .card-body').first(), key = card.find('.code').first();
    observedCode = key.children('a').first().text().trim() + key.children('span').last().text().trim();
    identityVerified = sameCode(observedCode, code) && main.find('.single-video').length > 0;
    displayTitle = title(main.find('h1 strong').first().text(), code);
    const videos = main.find('.single-video video');
    const primary = main.find('#seo-main-video video, video#seo-main-video').first();
    const video = primary.length ? primary : videos.length === 1 ? videos.first() : videos.slice(0, 0);
    cover = video.attr('poster') || video.attr('data-poster') || main.find('.single-video img').first().attr('src');
    const date = card.children('div').filter((_, node) => /^(公開日時|發佈於|日期)[:：]/.test($(node).children('span').first().text().trim())).first();
    fields = { release_date: validDate(date.children('span').eq(1).text()), studio: clean(card.find('.maker a').first().text()),
      genre: card.find('a.genre').toArray().map(node => clean($(node).text(), 256)).filter(Boolean).join(', ') };
    creditRole = 'maker';
  } else if (siteRef === 'fc2_official') {
    const digits = code.slice(4), main = $('.items_article_left').first();
    const canonicalUrl = canonical ? new URL(canonical, origin) : null;
    const iframe = main.find('iframe[src*="/widget/article/"]').first().attr('src');
    identityVerified = canonicalUrl?.origin === origin && canonicalUrl.pathname === '/article/' + digits + '/' &&
      iframe?.split('?')[0] === '/widget/article/' + digits + '/description' && main.find('.items_article_MainitemThumb').length === 1;
    observedCode = identityVerified ? code : null;
    displayTitle = title(main.find('.items_article_headerInfo h3').first().text(), code);
    cover = main.find('ul[data-feed="sample-images"] a').first().attr('href') || main.find('.items_article_MainitemThumb img').first().attr('src');
    fields = { studio: clean(main.find('li').filter((_, node) => /^\s*by\s/.test($(node).text())).first().find('a').text(), 256) };
    creditRole = 'seller';
  } else if (siteRef === 'heydouga_official') {
    const parts = code.match(/^HEYDOUGA-(\d{4})-(\d{3,5})$/), expected = parts && '/moviepages/' + parts[1] + '/' + parts[2] + '/index.html';
    identityVerified = !!expected && canonical === origin + expected && $('#movie-player').length === 1 &&
      html.includes('/sample/' + parts[1] + '/' + parts[2] + '/file_type.php');
    observedCode = identityVerified ? code : null;
    displayTitle = title($('#title-bg h1').first().text(), code);
    cover = $('meta[property="og:image"]').attr('content');
    if (!parts || !cover?.includes('/contents/' + parts[1] + '/' + parts[2] + '/player_thumb.')) cover = null;
  } else if (siteRef === 'caribbeancom_official') {
    const match = html.match(/\bvar\s+Movie\s*=\s*(\{[^;]+\})\s*;/);
    let movie = null;
    try { if (match && match[1].length < 128 * 1024) movie = JSON.parse(match[1]); } catch { /* Reject malformed primary data. */ }
    identityVerified = movie?.movie_id === code && [true, 1, '1'].includes(movie.is_mp4);
    observedCode = movie?.movie_id || null;
    displayTitle = title($('h1').first().text(), code);
    // This path is the publisher's declared primary image template, not a guessed CID mapping.
    cover = identityVerified ? '/moviepages/' + code + '/images/l_l.jpg' : null;
  } else if (siteRef === 'avwiki') {
    const main = $('section.article-body').first(), rows = {};
    main.find('dl.dltable dt').each((_, node) => { rows[clean($(node).text(), 128)] = clean($(node).next('dd').text()); });
    observedCode = rows['メーカー品番'];
    const product = main.find('a[href]').toArray().some(node => {
      try { const url = new URL($(node).attr('href')); return url.origin === 'https://www.mgstage.com' && url.pathname === '/product/product_detail/' + code + '/'; }
      catch { return false; }
    });
    identityVerified = observedCode === code && rows['MGS品番'] === code && canonical === origin + '/' + code.toLowerCase() + '/' && product;
    displayTitle = title(main.find('div > p').first().text().replace(/^【[^】]+】\s*/, ''), code);
    const image = $('header a.image-link-border img').first();
    const variants = String(image.attr('srcset') || '').split(',').map(value => value.trim().match(/^(\S+)\s+(\d+)w$/))
      .filter(Boolean).sort((left, right) => Number(right[2]) - Number(left[2]));
    cover = variants[0]?.[1] || image.attr('src');
    fields = { release_date: validDate(rows['配信開始日']), studio: rows['メーカー'] };
    creditRole = 'maker';
  } else if (siteRef === 'dl_getchu' || siteRef === 'gyutto') {
    const digits = code.split('-')[1], rows = {};
    if (siteRef === 'dl_getchu') {
      const form = $('form[action="https://dl.getchu.com/cart/"]').first();
      form.find('td.bluetext').each((_, node) => { rows[clean($(node).text(), 128)] = clean($(node).parent().children('td').eq(1).text()); });
      identityVerified = canonical === origin + '/i/item' + digits && /動画|映像|MP4|WMV/i.test([rows['作品種別'], rows['作品形式'], rows['ファイル形式']].join(' '));
      displayTitle = title($('meta[property="og:title"]').attr('content') || form.find('h1').text(), code);
      cover = $('img[src*="' + digits + 'top.jpg"]').first().attr('src');
      fields = { release_date: validDate(rows['配信開始日']), studio: rows['サークル'], genre: rows['趣向'] };
    } else {
      $('dl.BasicInfo dt').each((_, node) => { const key = clean($(node).text(), 128); if (!rows[key]) rows[key] = clean($(node).next('dd').text()); });
      identityVerified = canonical?.split('?')[0] === origin + '/i/item' + digits && /動画|映像|MP4|WMV/i.test([rows['カテゴリー'], rows['作品形式']].join(' '));
      displayTitle = title($('h1').first().text(), code);
      cover = $('a.highslide img').first().attr('src');
      fields = { release_date: validDate(rows['配信開始日']), studio: rows['サークル'], genre: rows['ジャンル'] };
    }
    observedCode = identityVerified ? code : null;
    creditRole = 'circle';
  }
  const descriptiveEntries = [{ key: 'title', value: displayTitle }, ...Object.entries(fields).map(([key, value]) => ({ key, value: clean(value) }))]
    .filter(entry => entry.value).sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
  if (fields.studio && creditRole) descriptiveEntries.push({ key: 'studio_credit_role', value: creditRole });
  descriptiveEntries.sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
  return { identityVerified, observedCode, canonicalResourceUrl: canonical || null, title: displayTitle, coverUrl: cover ? new URL(cover, origin).toString() : null,
    descriptiveEntries, peopleHints: [...new Set(people.filter(Boolean))].slice(0, 64).map(displayName => ({ displayName, role: 'actor', providerIdentities: [] })) };
}

module.exports = Object.freeze({ document, javDbCandidates, parseJavSourcePage });
