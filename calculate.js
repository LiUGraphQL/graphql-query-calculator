var _ = require('lodash');
var Hashtable = require('jshashtable');
var HashTableArrays = require('./hashtable');
var deleteKey = require('key-del');
var {
  GraphQLError
} = require('graphql');
var {
  getEdges,
  getRootNode,
  nodeType
} = require('./functions');


function arrSum(arr) {
  return arr.reduce(function fn(a, b) {
    if (Array.isArray(b)) {
      return b.reduce(fn, a);
    } else if (b === Math.round(b)) {
      return a + b;
    }
    return a;
  }, 0);
}

const queryCalculator = (g, maxSize, validationContext) => {
  try {
    if (_.size(validationContext.getDocument().definitions) > 1) {
      return Promise.resolve(validationContext);
    }

    const calculate = (u, query, parent) => {

      if (!(_.some(labels.get(u), function(o) {
          return _.isEqual(o, query);
        }))) {
        if (!labels.containsKey(u)) {
          labels.put(u, [query]);
        } else {
          labels.get(u).push(query);
        }

        if (query.length > 1) {
          //  console.log("MultiQuery:C4");
          return Promise.all(query.map(item => {
            sizeMap.add([u, query], sizeMap.ret([u, [item]]));
            return calculate(u, [item], parent);
          }));

        } else if (!(query[0].selectionSet)) {
          //  console.log("FieldQuery:C1");
          sizeMap.add([u, query], 3);
          return Promise.resolve();

        } else if (query[0].kind === 'Field') {
          //  console.log('ListQuery:C2');
          let fieldDef = parent.getFields()[query[0].name.value];
          let currParent = fieldDef.astNode.type.kind === 'ListType' ? fieldDef.type.ofType : fieldDef.type;
          return getEdges(g, query[0], u, fieldDef)
            .then(result => {
              if (fieldDef.astNode.type.kind === 'ListType') {
                sizeMap.add([u, query], 4);
              } else if (result.length > 0) {
                sizeMap.add([u, query], 2);
              } else {
                sizeMap.add([u, query], 3);
              }
              return Promise.all(result.map(item => {
                sizeMap.add([u, query], 2);
                sizeMap.add([u, query], sizeMap.ret([item, query[0].selectionSet.selections]));
                return calculate(item, query[0].selectionSet.selections, currParent);
              }));
            });

        } else if (query[0].kind === 'InlineFragment') {
          //console.log('InlineFragmentQuery:C3');
          let onType = query[0].typeCondition.name.value;
          if (nodeType(g, u) === onType) {
            sizeMap.add([u, query], sizeMap.ret([u, query[0].selectionSet.selections]));
            return calculate(u, query[0].selectionSet.selections, validationContext.getSchema().getType(onType));
          } else {
            return Promise.resolve();
          }
        }

      } else {
        //  console.log('query exists in labels');
        return Promise.resolve();
      }
    };

    var labels = new Hashtable();
    var sizeMap = new HashTableArrays();
    var query = deleteKey(validationContext.getDocument().definitions[0].selectionSet.selections, 'loc');
    let queryType = validationContext.getSchema().getQueryType();
    const rootNode = getRootNode(g, queryType);

    return calculate(rootNode, query, queryType)
      .then(() => {
        const querySize = arrSum(sizeMap.ret([rootNode, query]));
        console.log('Size of result: ' + querySize);
        if (querySize > maxSize) {
          validationContext.reportError(
            new GraphQLError(
              `Validation: Size of query result is ${querySize}, which exceeds maximum size of ${maxSize}`)
          );
        }
        return validationContext;
      });

  } catch (err) {
    {
      console.error(err);
      throw err;
    }
  }
};

module.exports = queryCalculator;
