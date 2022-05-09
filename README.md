A Node/Typescript SDK that pushes data to and pulls data from an instance of an RStreams bus.

Full documentation and getting started guide here: rstreams-site-url/rstreams-node-sdk/

For this SDK API documentation, get started with the [RStreamsSdk](classes/index.RStreamsSdk.html).

## Put

Send events one at a time to an instance of the RStreams bus.

[Put Operation documentation](rstreams-site-url/rstreams-node-sdk/sdk-apis/standalone-ops/put/)

```typescript
import { ConfigurationResources, RStreamsSdk } from "leo-sdk";
import { PersonRaw, PersonRawResults } from "../lib/types";
import axios from "axios";

async function main() {
  const rsdk: RStreamsSdk  = new RStreamsSdk();
  const person = await getRandomPerson();
  await rsdk.putEvent('rstreams-example.load-people', 'rstreams-example.people', person);
}

async function getRandomPerson(): Promise<PersonRaw> {
  const NUM_EVENTS = 1;
  const url = `https://randomuser.me/api/?results=${NUM_EVENTS}&exc=login,registered,phone,cell,picture,id&noinfo`;
  const {data, status} = await axios.get<PersonRawResults>(url);
  
  if (status !== 200) {
    throw new Error('Unable to get randomPeople from https://randomuser.me API: ' + status);
  }
  
  console.log('Person: ' + data.results[0].name.first + ' ' + data.results[0].name.last);

  return data.results[0];
}

(async () => {
  await main();
})()
```

## Enrich

Read events from one queue, modify them and send them on to another queue of the RStreams bus.

[Enrich Operation documentation](rstreams-site-url/rstreams-node-sdk/sdk-apis/standalone-ops/enrich/)

```typescript
import { EnrichOptions,  RStreamsSdk } from "leo-sdk";
import { Person, PersonRaw } from "../lib/types";
import axios from "axios";

async function main() {
  const rsdk: RStreamsSdk  = new RStreamsSdk();
  const opts: EnrichOptions<PersonRaw, Person>  = {
    id: 'rstreams-example.people-to-peopleplus',
    inQueue: 'rstreams-example.people',
    outQueue: 'rstreams-example.peopleplus',
    start: 'z/2022/04/20',
    config: {
      limit: 2
    },
    transform: async (person: PersonRaw) => {
      const p: Person = translate(person);
      await addCountryCode(p);
      return p;
    }
  };

  await rsdk.enrichEvents<PersonRaw, Person>(opts);
}

interface CountryCode {cca2: string;}

/**
 * @param person The person to add addr.countryCode to by calling a public API to
 *               turn a country name in a 2 digit country code (iso cca2)
 */
 async function addCountryCode(person: Person): Promise<void> {
    const url = `https://restcountries.com/v3.1/name/${person.addr.country}?fullText=true&fields=cca2`;    
    const cc: CountryCode = await axios.get(url);
    person.addr.countryCode = cc.cca2;
  }

/**
 * @param p The type from the public API we want to modify
 * @returns The new type that is flatter and gets rid of some attributes don't need
 */
function translate(p: PersonRaw): Person {
  return {
    gender: p.gender,
    firstName: p.name.first,
    lastName: p.name.last,
    email: p.email,
    birthDate: p.dob.date,
    nationality: p.nat,
    addr: {
      addr1: p.location.street.number + ' ' + p.location.street.name,
      city: p.location.city, 
      state: p.location.state,
      country: p.location.country,
      postcode: p.location.postcode,
      longitude: p.location.coordinates.longitude,
      latitude: p.location.coordinates.latitude,
      tzOffset: p.location.timezone.offset,
      tzDesc: p.location.timezone.description
    }
  }
}

(async () => {
  await main();
})()
```

## Offload

Stream data down from an RStreams bus queue at scale, optionally modify it and send it to another source such as a database or file.

[Offload Operation documentation](rstreams-site-url/rstreams-node-sdk/sdk-apis/standalone-ops/offload/)

```typescript
import { OffloadOptions,  RStreamsSdk } from "leo-sdk";
import { Person } from "../lib/types";
import axios, { AxiosResponse } from "axios";

async function main() {
  const rsdk: RStreamsSdk  = new RStreamsSdk();
  const opts: OffloadOptions<Person>  = {
    id: 'rstreams-example.offload-one-peopleplus',
    inQueue: 'rstreams-example.people',
    start: 'z/2022/04/20',
    limit: 2,
    transform: async (person: Person) => {
        await savePerson(person);
        return true;        
    }
  };

  await rsdk.offloadEvents<Person>(opts);
}

interface PostResponse {
    success: boolean;
}

/**
 * @param person Save the person to another system.
 */
async function savePerson(person: Person): Promise<void> {
  const url = `https://run.mocky.io/v3/83997150-ab13-43da-9fb9-66051ba06c10?mocky-delay=500ms`;    
  const {data, status}: AxiosResponse<PostResponse, any> = await axios.post<PostResponse>(url, person);
  if (status !== 200 || !data || data.success !== true) {
    throw new Error('Saving person to external system failed');
  }
}

(async () => {
  await main();
})()
```