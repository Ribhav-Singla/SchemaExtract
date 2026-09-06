import { Db, MongoClient } from "mongodb";

const databaseName = "schema-extract";

declare global {
	var schemaExtractMongoClientPromise: Promise<MongoClient> | undefined;
}

function getMongoClientPromise(): Promise<MongoClient> {
	const uri = process.env.MONGODB_URI;

	if (!uri) {
		throw new Error("MONGODB_URI is not configured");
	}

	if (!global.schemaExtractMongoClientPromise) {
		const client = new MongoClient(uri);
		global.schemaExtractMongoClientPromise = client.connect();
	}

	return global.schemaExtractMongoClientPromise;
}

export async function getSchemaExtractDatabase(): Promise<Db> {
	const client = await getMongoClientPromise();
	const database = client.db(databaseName);

	await database.collection("extractions").createIndex({ created_on: 1 });

	return database;
}