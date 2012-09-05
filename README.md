# UFDS Replicator

* Repository: git@git.joyent.com:ufds-replicator.git
* Browsing: <https://mo.joyent.com/ufds-replicator>
* Who: Andres Rodriguez
* Docs: <https://mo.joyent.com/docs/ufds-replicator>
* Tickets/bugs: <https://devhub.joyent.com/jira/browse/CAPI>


# Overview

This library provides the functionality required to replicate data living on a
remote UFDS instance into a local one. Data replication on LDAP can be done in several ways and in our case we take advantage of the changelogs functionality that UFDS implements. In order to consume the changelog objects we can either use [persistent search](http://tools.ietf.org/id/draft-ietf-ldapext-psearch-03.txt) or polling. In our case we take the polling approach with a configurable search interval.


## Changelogs

The idea behind changelogs is that servers should be able to notify clients about each of the operations that have been produced in the remote LDAP server in an ordered way. By having access to said changelog, clients can replicate each of the changes made to an LDAP server provided that there are no conflicting existing records in the local LDAP instance at the time of applying these changes.

For more information, refer to the [LDAP changelogs specification](http://tools.ietf.org/html/draft-good-ldap-changelog-04).


## Replication URLs

ufds-replicator allows replicating multiple subtrees from the same remote UFDS instance. For the case of an SDC install, one could replicate the entire servers and users trees separately without caring about the rest of the SDC data such as config and groups. In order to do this, replication URLs must meet the [LDAP url](http://www.ietf.org/rfc/rfc2255.txt) format specification. This lets ufds-replicator know which additional criteria must the prospect records meet in order to be replicated. For example, a replication URL might specify that users with first name "Stan" should not be replicated. In this case, ufds-replicator provides the functionality needed to compare local objects to remote ones and decide when is an object eligible for replication.

The full format of a replication URL is the following:

		ldapurl = scheme "://" [hostport] ["/"
                    [dn ["?" [attributes] ["?" [scope]
                    ["?" [filter] ["?" extensions]]]]]]

If we ignore 'attributes' for now we now have:

		ldapurl = scheme "://" [hostport] ["/"
                    [dn ["??" [scope] ["?" [filter] ["?" extensions]]]]]

As an example, let's take a look at an URL for replicating all users in SDC:

		ldaps://10.99.99.14/ou=users,%20o=smartdc??sub?

And the following is the meaning of each of the fields in the URL:

||**field**||**value**||**meaning**||
||dn||ou=users, o=smartdc||base subtree to replicate||
||scope||sub||LDAP search scope, can be sub, one or base||
||filter||empty (defaults to objectclass=*)||LDAP search filter||

Given this, if we wanted to replicate only sdcperson or sdckey objects under the users tree (ignoring vms) our URL would look like:

		ldaps://10.99.99.14/ou=users,%20o=smartdc??sub?(!(objectclass=vm))


# Getting started

ufds-replicator requires two UFDS instances running at the same time. The local UFDS should have no data in it (for our tests). We will later see how a minimal set of bootstrap data is needed for tests to work.

If you already know how to deploy an additional moray/UFDS instance, skip to the "Replicating Data" section.

## Adding a New Postgres Instance

Before setting up a second moray zone, we need a new postgres server that can act as the backend for our local UFDS. There are no hard requirements, any 9.1 postgres should do the job.

After our additional postgres is running, let's create the moray database:

		$ psql -U postgres
		psql (9.1.5)
		Type "help" for help.

		postgres=# create database moray;
		CREATE DATABASE
		postgres=#

In order to be able to repeteadly run the replicator over the same remote UFDS instance, we just need to wipe the moray database every time with:

		postgres=# drop database moray;
		DROP DATABASE
		postgres=#


## Provisioning a Second Moray Zone

We will create a new moray zone and make it point to our local postgres instance. The easiest way to do so is with sdc-role:

		$ sdc-role create moray

		+ Sent provision to VMAPI for c4a80a48-11eb-4cbe-b890-12ad038e125f
		+ Job is /jobs/72324880-3cb8-42f1-ba2e-56582a13e514
		+ Job status changed to: queued
		+ Job status changed to: running
		+ All parameters OK!
		+ Got servers!
		+ Server allocated!
		+ NICs allocated!
		+ Provision queued!
		+ Job succeeded!
		+ VM is now running
		+ Job status changed to: succeeded
		+ Success!

We should now see a moray1 zone in the vmadm list output:

		# vmadm list | grep moray
		b096f8e2-c42c-40d4-8d72-1a2253173dd1  OS    128      running           moray0
		c4a80a48-11eb-4cbe-b890-12ad038e125f  OS    128      running           moray1

Now, let's login to moray1 and edit its configuration file to point to our second postgres. For a postgres running on Mac OS X we need to do something like this:

		$ zlogin c4a80a48-11eb-4cbe-b890-12ad038e125f
		# cd /opt/smartdc/moray
		# cat etc/config.json
		{
		    "port": 80,
		    "postgres": {
		        "url": "pg://postgres@10.88.88.1/moray",
		        "maxConns": 10,
		        "idleTimeout": 600000
		    },
		    "marker": {
		        "key": "13F435C10F0EC0C403E7AACB61429713",
		        "iv": "FF5442563050A98984F7DC703185B965"
		    }
		}

Restart moray.

## Running a Second UFDS Instance

A second UFDS zone can also provisioned the same way we provisioned a new moray zone. In this case, cloning the ufds.git repository (and runnning npm install) is a simple task too. After all, we just need to run a second UFDS instance regardless the method we use.

For running a UFDS server on Mac OS X follow the next steps:

		$ git clone git@git.joyent.com:ufds.git
		$ cd ufds/
		$ npm install

Now, we have to edit /etc/ufds.laptop.config.json so UFDS talks to our second moray instance:

		...
		"moray": {
			"url": "http://10.99.99.148",
		...

After editing the configuration file we can start the UFDS server with:

		node main.js -f ./etc/ufds.laptop.config.json -d 2 2>&1 | ./node_modules/.bin/bunyan

UFDS should be running and ready to be used.


## Replicating Data

ufds-replicator comes with a sample replicator code that can be used as a standalone server with minor modifications. This code is located at examples/replicator.js.

Assuming our second UFDS instance is pointing to a blank moray database, we need to load the minimal SDC bootstrap schema located at data/bootstrap.ldif. This data can be loaded with the following command (change your LDAP host and credentials variables accordingly):

		$ LDAPTLS_REQCERT=allow ldapadd -H ldap://127.0.0.1:1389 -x -D cn=root -w secret -f data/bootstrap.ldif

		adding new entry "o=smartdc"

		adding new entry "ou=users, o=smartdc"

		adding new entry "ou=groups, o=smartdc"

		adding new entry "ou=config, o=smartdc"

		adding new entry "datacenter=coal, o=smartdc"

		adding new entry "ou=servers, datacenter=coal, o=smartdc"

		adding new entry "cn=replicator, datacenter=coal, o=smartdc"

ufds-replicator is ready to be used.

The sample replicator code will replicate the "ou=users, o=smartdc" tree. Also, the local UFDS is assumed to run locally at "127.0.0.1:1389" and the remote UFDS is assumed a running SDC UFDS in the IP address "10.99.99.14". You can override these parameters without the need to modify the example code. Run the example replicator with the following command:

		UFDS_IP=10.99.99.14 LOCAL_UFDS_IP='127.0.0.1:1389' node examples/replicator.js | ./node_modules/.bin/bunyan

As soon as the replicator has finished replicating the entire changelog it will keep polling and listening for new changelogs from the upstream UFDS.


## Recreating the Test Environment

If you are interested in running the replicator many times from a blank databse all you have to do is drop the moray database and restart the moray and ufds services:

		// moray zone
		$ svcadm disable moray

		// ufds server
		^C

		// postgres shell
		postgres=# drop database moray;
		postgres=# create database moray;

		// moray zone
		$ svcadm enable moray

		// ufds server
		$ node main.js -f ./etc/ufds.laptop.config.json -d 2 2>&1 | ./node_modules/.bin/bunyan

		// reload bootstrap data
		$ LDAPTLS_REQCERT=allow ldapadd -H ldap://127.0.0.1:1389 -x -D cn=root -w secret -f data/bootstrap.ldif


## Running the Tests

The ufds-replicator tests are very similar to the example replicator code, although it additionally creates some records on UFDS to verify that data is actually being replicated.

After having a test environment with the bootstrap data loaded into the local UFDS instance run the following command (change your LDAP host and credentials variables accordingly):

		UFDS_IP=10.99.99.14 LOCAL_UFDS_IP='127.0.0.1:1389' make test | ./node_modules/.bin/bunyan

Note that every time you run the tests, more of the same changelogs are created on top of the last tests that have run. Given the nature of the replicator, this should not affect future tests that run one after another.

