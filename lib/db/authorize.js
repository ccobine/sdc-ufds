/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var ldap = require('ldapjs');

var common = require('./common');



///--- Handlers

function authorize(req, res, next) {
    if (req.type === 'BindRequest') {
        return next();
    }

    var bindDN = req.connection.ldap.bindDN;

    // Leaky abstraction; we assume a config.rootDN was set
    if (bindDN.equals(req.config.rootDN)) {
        return next();
    }

    if (bindDN.equals(req.dn) || bindDN.parentOf(req.dn)) {
        return next();
    }

    // Otherwise check the backend
    var t = req.config[req.suffix];
    if (!t || !t.administratorsGroupRDN) {
        return next(new ldap.InsufficientAccessRightsError());
    }

    var dn = t.administratorsGroupRDN + ', ' + req.suffix;
    return req.moray.getObject(t.bucket, dn, function (err, obj) {
        if (err) {
            req.log.warn({
                bucket: t.bucket,
                admininstratorsGroupDN: dn,
                suffix: req.suffix,
                err: err
            }, 'Unable to retrieve admin group');
            return next(new ldap.InsufficientAccessRightsError());
        }
        var group = obj.value;

        if (group.uniquemember.indexOf(bindDN.toString()) === -1) {
            return next(new ldap.InsufficientAccessRightsError());
        }

        return next();
    });
}



///--- Exports

module.exports = authorize;
