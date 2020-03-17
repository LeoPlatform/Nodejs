module.exports = {
	tables: [{
		AttributeDefinitions: [
			{
				AttributeName: 'id',
				AttributeType: 'S'
			}
		],
		KeySchema: [
			{
				AttributeName: 'id',
				KeyType: 'HASH'
			}
		],
		ProvisionedThroughput: {
			ReadCapacityUnits: 5,
			WriteCapacityUnits: 5
		},
		TableName: "InMemory_LeoCron"
	}],
	port: 8000,
	options: ['-inMemory', '-help']
};
