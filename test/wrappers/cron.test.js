const AWS = require('aws-sdk');
AWS.config.dynamodb = { 
	endpoint: 'localhost:8000' ,
	sslEnabled: false,
	region: 'local-env'
};

const cron = require("../../wrappers/cron");
// jest.unmock('dynamodb-local');
// jest.unmock('aws-sdk');
// jest.unmock('../../wrappers/cron');

// global.leosdk = {
// 	resources: {
// 		LeoCron: "TestCronTableMock",
// 		LeoSettings: "TestSettingsTableMock",
// 		LeoSystem: "TestSystemTableMock"
// 	}
// };

// jest.mock("../../leoConfigure.js", () => {
// 	return {
// 		name: "foo_cron_id_botname",
// 		registry: {
// 			id: "test_function_name"
// 		},
// 		cron: {
// 			settings: {

// 			}
// 		}
// 	};
// });

function testLambda(event, _, callback) {
	callback(null, event);
}

describe("Cron Wrapper", () => {
	// With/Without force
	// Bot Didn't exist in Cron.  Saving Cron Entry
	// it("With cron, check lock", () => {});
	// it("Without cron, create lock", () => {});

	it("works", () => {
		const wrappedTestLambda = cron(testLambda);
		const event = {
			// __cron: {
			// 	id: "foo_cron_id",
			// 	iid: "123-iid",
			// 	ts: 1583870795916
			// }
		};
		const context = {
			awsRequestId: "abc-124-test-run-id", 
			getRemainingTimeInMillis: () => 4 * 60 * 1000 // 4 min
		};
		wrappedTestLambda(event, context, (err, data) => {
			expect(err).toBeNull();
			expect(data).toBeDefined();
		});
	});
});
