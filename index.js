const Scope = require('./src/scope');
const _ = require('./src/util/underscore.js');
const assert = require('./src/util/assert.js');
const tokenizer = require('./src/tokenizer.js');
const statFileAsync = require('./src/util/fs.js').statFileAsync;
const readFileAsync = require('./src/util/fs.js').readFileAsync;
const pathResolve = require('./src/util/fs.js').pathResolve;
const Render = require('./src/render.js');
const lexical = require('./src/lexical.js');
const Tag = require('./src/tag.js');
const Filter = require('./src/filter.js');
const Template = require('./src/parser');
const Syntax = require('./src/syntax.js');
const tags = require('./tags');
const filters = require('./filters');
const Promise = require('any-promise');
const anySeries = require('./src/util/promise.js').anySeries;
const Errors = require('./src/util/error.js');

var _engine = {
    init: function(tag, filter, options) {
        if (options.cache) {
            this.cache = {};
        }
        this.options = options;
        this.tag = tag;
        this.filter = filter;
        this.parser = Template(tag, filter);
        this.renderer = Render();

        tags(this);
        filters(this);

        return this;
    },
    parse: function(html) {
        var tokens = tokenizer.parse(html);
        return this.parser.parse(tokens);
    },
    render: function(tpl, ctx, opts) {
        var scope = Scope.factory(ctx, opts);
        return this.renderer.renderTemplates(tpl, scope);
    },
    parseAndRender: function(html, ctx, opts) {
        return Promise.resolve()
            .then(() => this.parse(html))
            .then(tpl => this.render(tpl, ctx, opts))
            .catch(e => {
                if (e instanceof Errors.RenderBreak) {
                    return e.html;
                }
                throw e;
            });
    },
    renderFile: function(filepath, ctx, opts) {
        opts = _.assign({}, opts);
        return this.getTemplate(filepath, opts.root)
            .then(templates => this.render(templates, ctx, opts))
            .catch(e => {
                e.file = filepath;
                throw e;
            });
    },
    evalOutput: function(str, scope) {
        var tpl = this.parser.parseOutput(str.trim());
        return this.renderer.evalOutput(tpl, scope);
    },
    registerFilter: function(name, filter) {
        return this.filter.register(name, filter);
    },
    registerTag: function(name, tag) {
        return this.tag.register(name, tag);
    },
    lookup: function(filepath, root) {
        root = this.options.root.concat(root || []);
        var paths = root.map(root => pathResolve(root, filepath));
        return anySeries(paths, path => statFileAsync(path).then(() => path))
            .catch((e) => {
                if (e.code === 'ENOENT') {
                    e.message = `Failed to lookup ${filepath} in: ${root}`;
                }
                throw e;
            });
    },
    getTemplate: function(filepath, root) {
        if (!filepath.match(/\.\w+$/)) {
            filepath += this.options.extname;
        }
        return this
            .lookup(filepath, root)
            .then(filepath => {
                if (this.options.cache) {
                    var tpl = this.cache[filepath];
                    if (tpl) {
                        return Promise.resolve(tpl);
                    }
                    return readFileAsync(filepath)
                        .then(str => this.parse(str))
                        .then(tpl => this.cache[filepath] = tpl);
                } else {
                    return readFileAsync(filepath).then(str => this.parse(str));
                }
            });
    },
    express: function(opts) {
        opts = opts || {};
        var self = this;
        return function(filePath, ctx, callback) {
            assert(_.isArray(this.root) || _.isString(this.root), 
                   'illegal views root, are you using express.js?');
            opts.root = this.root;
            self.renderFile(filePath, ctx, opts)
                .then(html => callback(null, html))
                .catch(e => callback(e));
        };
    }
};

function factory(options) {
    options = _.assign({}, options);
    options.root = normalizeStringArray(options.root);
    if (!options.root.length) options.root = ['.'];

    options.extname = options.extname || '.liquid';

    var engine = Object.create(_engine);

    engine.init(Tag(), Filter(), options);
    return engine;
}

function normalizeStringArray(value) {
    if (_.isArray(value)) return value;
    if (_.isString(value)) return [value];
    return [];
}

factory.lexical = lexical;
factory.isTruthy = Syntax.isTruthy;
factory.isFalsy = Syntax.isFalsy;
factory.evalExp = Syntax.evalExp;
factory.evalValue = Syntax.evalValue;
factory.Types = {
    ParseError: Errors.ParseError,
    TokenizationEroor: Errors.TokenizationError,
    RenderBreak: Errors.RenderBreak,
    AssertionError: Errors.AssertionError
};

module.exports = factory;
