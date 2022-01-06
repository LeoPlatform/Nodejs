'use strict';

module.exports = {
    _global: {
        region: 'us-east-1',
    },
    _local: {},
    dev: {
        leoProfile: 'dsco-test',
        leoauth: {
            LeoAuth: 'TestAuth-LeoAuth-1OA6GK80E4BB8',
            LeoAuthIdentity: 'TestAuth-LeoAuthIdentity-9LT3M4KKW8VR',
            LeoAuthPolicy: 'TestAuth-LeoAuthPolicy-60MEU1B5ZKAS',
            LeoAuthUser: 'TestAuth-LeoAuthUser-OZ7R6RHZIPDY',
            Region: 'us-east-1',
        },
        leosdk: {
            LeoArchive: 'TestBus-LeoArchive-WUWG7N8OXG97',
            LeoCron: 'TestBus-LeoCron-OJ8ZNCEBL8GM',
            LeoEvent: 'TestBus-LeoEvent-FNSO733D68CR',
            LeoFirehoseStream: 'TestBus-LeoFirehoseStream-1M8BJL0I5HQ34',
            LeoKinesisStream: 'TestBus-LeoKinesisStream-1XY97YYPDLVQS',
            LeoS3: 'testbus-leos3-1erchsf3l53le',
            LeoSettings: 'TestBus-LeoSettings-YHQHOKWR337E',
            LeoStream: 'TestBus-LeoStream-R2VV0EJ6FRI9',
            LeoSystem: 'TestBus-LeoSystem-L9OY6AV8E954',
            Region: 'us-east-1',
        },
    },
    drtest: {
        profile: 'default',
    },
    utest: {
        gearman: {
            host: 'dummyHost',
            host2: 'dummyHost2',
            port: 4730,
        },
        leoProfile: '',
        leoauth: {
            LeoAuth: 'dummyLeoAuth',
            LeoAuthIdentity: 'dummyLeoAuthIdentity',
            LeoAuthPolicy: 'dummyLeoAuthPolicy',
            LeoAuthUser: 'dummyLeoAuthUser',
            Region: 'dummyRegion',
        },
        leosdk: {
            LeoArchive: 'dummyLeoArchiveTable',
            LeoCron: 'dummyLeoCronTable',
            LeoEvent: 'LdummyeoEventTable',
            LeoFirehoseStream: 'dummyLeoFirehoseStream',
            LeoKinesisStream: 'dummyLeoKinesisStream',
            LeoS3: 'dummyLeoS3',
            LeoSettings: 'dummyLeoSettingsTable',
            LeoStream: 'dummyLeoStreamTable',
            LeoSystem: 'dummyLeoSystemTable',
            Region: 'dummyRegion',
        },
        profile: 'default',
    },
    test: {
        gearman: {
            host: 'gearman',
            host2: 'gearman02',
            port: 4730,
        },
        leoProfile: 'dsco-test',
        leoauth: {
            LeoAuth: 'TestAuth-LeoAuth-1OA6GK80E4BB8',
            LeoAuthIdentity: 'TestAuth-LeoAuthIdentity-9LT3M4KKW8VR',
            LeoAuthPolicy: 'TestAuth-LeoAuthPolicy-60MEU1B5ZKAS',
            LeoAuthUser: 'TestAuth-LeoAuthUser-OZ7R6RHZIPDY',
            Region: 'us-east-1',
        },
        leosdk: {
            LeoArchive: 'TestBus-LeoArchive-WUWG7N8OXG97',
            LeoCron: 'TestBus-LeoCron-OJ8ZNCEBL8GM',
            LeoEvent: 'TestBus-LeoEvent-FNSO733D68CR',
            LeoFirehoseStream: 'TestBus-LeoFirehoseStream-1M8BJL0I5HQ34',
            LeoKinesisStream: 'TestBus-LeoKinesisStream-1XY97YYPDLVQS',
            LeoS3: 'testbus-leos3-1erchsf3l53le',
            LeoSettings: 'TestBus-LeoSettings-YHQHOKWR337E',
            LeoStream: 'TestBus-LeoStream-R2VV0EJ6FRI9',
            LeoSystem: 'TestBus-LeoSystem-L9OY6AV8E954',
            Region: 'us-east-1',
        },
        profile: 'default',
    }
};
