const { Client, GatewayIntentBits, AuditLogEvent, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// الاعدادات
const TRUSTED_USERS = ['1438036495838609471', '768204981282275368'];
const PROTECTED_BOTS = ['1456820031374495920', '1456629479983022328'];
const LOG_CHANNEL_ID = '1456841946562826403';
const VOICE_CHANNEL_ID = '1454050373332635773';
const SPAM_LIMIT = 5;
const SPAM_TIME_WINDOW = 10000; // 10 ثواني

// دخول الروم الصوتي
async function joinVoiceChannel(guild) {
    try {
        const voiceChannel = await guild.channels.fetch(VOICE_CHANNEL_ID);
        if (voiceChannel && voiceChannel.isVoiceBased()) {
            const { joinVoiceChannel: connectToVoice, getVoiceConnection } = require('@discordjs/voice');
            
            // التحقق من الاتصال الحالي
            const existingConnection = getVoiceConnection(guild.id);
            if (existingConnection) {
                // اذا موجود اتصال، نتأكد انه في نفس الروم
                if (existingConnection.joinConfig.channelId === VOICE_CHANNEL_ID) {
                    return;
                }
                // اذا في روم ثاني، نقطع الاتصال ونتصل بالروم الصحيح
                existingConnection.destroy();
            }
            
            const connection = connectToVoice({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: true
            });
            
            console.log(`🔊 تم الدخول للروم الصوتي: ${voiceChannel.name}`);
            
            // اعادة الاتصال اذا انقطع
            connection.on('stateChange', (oldState, newState) => {
                if (newState.status === 'disconnected') {
                    console.log('⚠️ انقطع الاتصال، محاولة اعادة الاتصال...');
                    setTimeout(() => joinVoiceChannel(guild), 1000);
                }
            });
        }
    } catch (error) {
        console.error('خطأ في الدخول للروم الصوتي:', error);
        // محاولة مرة ثانية بعد 3 ثواني
        setTimeout(() => joinVoiceChannel(guild), 3000);
    }
}

// تتبع السبام
const userActions = new Map();
const mentionSpam = new Map();

// ارسال تقرير
async function sendReport(guild, title, description, executor, target) {
    try {
        const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setColor('#FFFFFF')
            .setTitle(`**${title}**`)
            .setDescription(`**${description}**`)
            .addFields(
                { name: '**الشخص المنفذ**', value: `**${executor?.tag || 'غير معروف'} (${executor?.id || 'N/A'})**`, inline: true },
                { name: '**الهدف**', value: `**${target?.tag || target?.name || 'غير معروف'}**`, inline: true },
                { name: '**الوقت**', value: `**<t:${Math.floor(Date.now() / 1000)}:F>**`, inline: false }
            )
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error('خطأ في ارسال التقرير:', error);
    }
}

// تصفير الرتب
async function removeAllRoles(member) {
    try {
        const roles = member.roles.cache.filter(role => role.id !== member.guild.id);
        await member.roles.remove(roles);
    } catch (error) {
        console.error('خطأ في تصفير الرتب:', error);
    }
}

// تايم اوت 999 سنة
async function timeoutMember(member) {
    try {
        const duration = 999 * 365 * 24 * 60 * 60 * 1000;
        await member.timeout(Math.min(duration, 2419200000), 'انتهاك قواعد الحماية');
    } catch (error) {
        console.error('خطأ في اعطاء تايم اوت:', error);
    }
}

// حماية ضد اضافة بوتات
client.on('guildMemberAdd', async (member) => {
    if (!member.user.bot) return;
    if (PROTECTED_BOTS.includes(member.user.id)) return;

    try {
        const auditLogs = await member.guild.fetchAuditLogs({
            type: AuditLogEvent.BotAdd,
            limit: 1
        });

        const botAddLog = auditLogs.entries.first();
        if (!botAddLog) return;

        const executor = botAddLog.executor;
        if (TRUSTED_USERS.includes(executor.id)) return;

        // طرد البوت
        await member.kick('بوت غير مصرح به');

        // تصفير رتب الشخص الي ضاف البوت
        const executorMember = await member.guild.members.fetch(executor.id);
        await removeAllRoles(executorMember);

        // ارسال تقرير
        await sendReport(
            member.guild,
            'تم منع اضافة بوت',
            'تم طرد بوت غير مصرح وتصفير رتب الشخص الي ضافه',
            executor,
            member.user
        );
    } catch (error) {
        console.error('خطأ في حماية البوتات:', error);
    }
});

// حماية ضد الويب هوك
client.on('webhookUpdate', async (channel) => {
    try {
        const webhooks = await channel.fetchWebhooks();
        const auditLogs = await channel.guild.fetchAuditLogs({
            type: AuditLogEvent.WebhookCreate,
            limit: 1
        });

        const webhookLog = auditLogs.entries.first();
        if (!webhookLog) return;

        const executor = webhookLog.executor;
        if (TRUSTED_USERS.includes(executor.id)) return;
        if (PROTECTED_BOTS.includes(executor.id)) return;

        // حذف جميع الويب هوكات الجديدة
        for (const webhook of webhooks.values()) {
            await webhook.delete('ويب هوك غير مصرح');
        }

        // تصفير رتب المنشئ
        const executorMember = await channel.guild.members.fetch(executor.id);
        await removeAllRoles(executorMember);

        // ارسال تقرير
        await sendReport(
            channel.guild,
            'تم منع انشاء ويب هوك',
            'تم حذف ويب هوك وتصفير رتب المنشئ',
            executor,
            { name: `قناة ${channel.name}` }
        );
    } catch (error) {
        console.error('خطأ في حماية الويب هوك:', error);
    }
});

// حماية ضد سبام المنشن
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (TRUSTED_USERS.includes(message.author.id)) return;

    const hasMention = message.mentions.everyone || message.content.includes('@here');
    if (!hasMention) return;

    const userId = message.author.id;
    const now = Date.now();

    if (!mentionSpam.has(userId)) {
        mentionSpam.set(userId, []);
    }

    const userMentions = mentionSpam.get(userId);
    userMentions.push(now);

    // تنظيف المنشنات القديمة
    const recentMentions = userMentions.filter(time => now - time < SPAM_TIME_WINDOW);
    mentionSpam.set(userId, recentMentions);

    if (recentMentions.length >= SPAM_LIMIT) {
        try {
            const member = message.member;
            
            // حذف الرسائل
            await message.delete();

            // تايم اوت وتصفير الرتب
            await timeoutMember(member);
            await removeAllRoles(member);

            // ارسال تقرير
            await sendReport(
                message.guild,
                'تم منع سبام منشن',
                'تم اعطاء تايم اوت وتصفير الرتب لسبام المنشن',
                message.author,
                message.author
            );

            mentionSpam.delete(userId);
        } catch (error) {
            console.error('خطأ في منع سبام المنشن:', error);
        }
    }
});

// حماية ضد سبام الرومات
client.on('channelCreate', async (channel) => {
    try {
        const auditLogs = await channel.guild.fetchAuditLogs({
            type: AuditLogEvent.ChannelCreate,
            limit: 10
        });

        const recentChannels = auditLogs.entries.filter(entry => {
            return Date.now() - entry.createdTimestamp < SPAM_TIME_WINDOW &&
                   entry.target.name === channel.name;
        });

        if (recentChannels.size < SPAM_LIMIT) return;

        const executor = recentChannels.first().executor;
        if (TRUSTED_USERS.includes(executor.id)) return;
        if (PROTECTED_BOTS.includes(executor.id)) return;

        // حذف القنوات المكررة
        for (const entry of recentChannels.values()) {
            try {
                const ch = await channel.guild.channels.fetch(entry.target.id);
                if (ch) await ch.delete('سبام قنوات');
            } catch (e) {}
        }

        // معاقبة المنشئ
        const executorMember = await channel.guild.members.fetch(executor.id);
        await timeoutMember(executorMember);
        await removeAllRoles(executorMember);

        // ارسال تقرير
        await sendReport(
            channel.guild,
            'تم منع سبام قنوات',
            'تم حذف القنوات واعطاء تايم اوت وتصفير الرتب',
            executor,
            { name: `قنوات بأسم ${channel.name}` }
        );
    } catch (error) {
        console.error('خطأ في حماية القنوات:', error);
    }
});

// حماية ضد سبام الرتب
client.on('roleCreate', async (role) => {
    try {
        const auditLogs = await role.guild.fetchAuditLogs({
            type: AuditLogEvent.RoleCreate,
            limit: 10
        });

        const recentRoles = auditLogs.entries.filter(entry => {
            return Date.now() - entry.createdTimestamp < SPAM_TIME_WINDOW &&
                   entry.target.name === role.name;
        });

        if (recentRoles.size < SPAM_LIMIT) return;

        const executor = recentRoles.first().executor;
        if (TRUSTED_USERS.includes(executor.id)) return;
        if (PROTECTED_BOTS.includes(executor.id)) return;

        // حذف الرتب المكررة
        for (const entry of recentRoles.values()) {
            try {
                const r = await role.guild.roles.fetch(entry.target.id);
                if (r) await r.delete('سبام رتب');
            } catch (e) {}
        }

        // معاقبة المنشئ
        const executorMember = await role.guild.members.fetch(executor.id);
        await timeoutMember(executorMember);
        await removeAllRoles(executorMember);

        // ارسال تقرير
        await sendReport(
            role.guild,
            'تم منع سبام رتب',
            'تم حذف الرتب واعطاء تايم اوت وتصفير الرتب',
            executor,
            { name: `رتب بأسم ${role.name}` }
        );
    } catch (error) {
        console.error('خطأ في حماية الرتب:', error);
    }
});

// كشف النشاطات المشبوهة
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
        
        if (addedRoles.size > 3) {
            const auditLogs = await newMember.guild.fetchAuditLogs({
                type: AuditLogEvent.MemberRoleUpdate,
                limit: 1
            });

            const roleUpdate = auditLogs.entries.first();
            if (!roleUpdate) return;

            const executor = roleUpdate.executor;
            if (TRUSTED_USERS.includes(executor.id)) return;
            if (PROTECTED_BOTS.includes(executor.id)) return;

            await sendReport(
                newMember.guild,
                'نشاط مشبوه - اضافة رتب جماعية',
                `تم اضافة ${addedRoles.size} رتب دفعة واحدة`,
                executor,
                newMember.user
            );
        }
    } catch (error) {
        console.error('خطأ في كشف النشاطات:', error);
    }
});

client.on('ready', () => {
    console.log(`✅ البوت شغال: ${client.user.tag}`);
    console.log(`🛡️ نظام الحماية مفعل ومستعد`);
    
    // تعيين الحالة والنشاط
    client.user.setPresence({
        activities: [{
            name: '.gg/408',
            type: 3 // 3 = Watching
        }],
        status: 'idle' // idle = خامل
    });
    
    // الدخول للروم الصوتي في كل السيرفرات
    client.guilds.cache.forEach(guild => {
        joinVoiceChannel(guild);
    });
});

// اذا البوت انطرد من الروم يرجع يدخل
client.on('voiceStateUpdate', (oldState, newState) => {
    // التحقق اذا البوت هو الي تغيرت حالته
    if (newState.member.id === client.user.id) {
        const targetChannelId = VOICE_CHANNEL_ID;
        
        // اذا البوت مو في الروم المطلوب (انطرد او انتقل او قطع)
        if (newState.channelId !== targetChannelId) {
            console.log('⚠️ البوت مو في الروم المطلوب، رجوع للروم...');
            setTimeout(() => {
                joinVoiceChannel(newState.guild);
            }, 1000);
        }
    }
});

// فحص دوري كل دقيقة للتأكد ان البوت في الروم
setInterval(() => {
    client.guilds.cache.forEach(guild => {
        const botVoiceState = guild.members.cache.get(client.user.id)?.voice;
        
        // اذا البوت مو في الروم المطلوب
        if (!botVoiceState || botVoiceState.channelId !== VOICE_CHANNEL_ID) {
            console.log('🔄 فحص دوري: البوت مو في الروم، اعادة الدخول...');
            joinVoiceChannel(guild);
        }
    });
}, 60000); // كل دقيقة

client.login(process.env.TOKEN);
